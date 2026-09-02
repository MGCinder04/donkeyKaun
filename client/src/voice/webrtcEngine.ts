import { getAuthToken } from "../lib/authToken";
import { API_BASE } from "../lib/config";
import { getSocket } from "../rooms/socket";

const FALLBACK_ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.cloudflare.com:3478" }];
const DISCONNECTED_RESTART_MS = 4_000;
const ICE_REQUEST_TIMEOUT_MS = 8_000;

type VoiceSignalPayload =
  | { type: "description"; description: RTCSessionDescriptionInit }
  | { type: "ice"; candidate: RTCIceCandidateInit };

export type PeerVoiceStatus = "connecting" | "connected" | "reconnecting" | "failed";

interface PeerEntry {
  connection: RTCPeerConnection;
  audioEl: HTMLAudioElement;
  analyser: AnalyserNode | null;
  dataArray: Uint8Array<ArrayBuffer> | null;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  restartTimer: ReturnType<typeof setTimeout> | null;
}

export interface VoiceEngineSnapshot {
  speakingLevels: Map<string, number>;
  peerStatuses: Map<string, PeerVoiceStatus>;
  playbackBlocked: boolean;
  turnAvailable: boolean;
}

let localStream: MediaStream | null = null;
let myDeviceId = "";
let roomCode = "";
let audioContext: AudioContext | null = null;
let localAnalyser: AnalyserNode | null = null;
let localDataArray: Uint8Array<ArrayBuffer> | null = null;
let iceServers: RTCIceServer[] = FALLBACK_ICE_SERVERS;
let turnAvailable = false;
let sessionReady = false;
let sessionGeneration = 0;
let playbackBlocked = false;
let listeningMuted = false;
let signalHandler: ((payload: { deviceId: string; data: VoiceSignalPayload }) => void) | null = null;
let socketConnectHandler: (() => void) | null = null;
let socketDisconnectHandler: (() => void) | null = null;
const earlySignals: Array<{ deviceId: string; data: VoiceSignalPayload }> = [];

const desiredPeers = new Set<string>();
const mutedPeers = new Set<string>();
const peers = new Map<string, PeerEntry>();

function ensureAudioContext(): AudioContext {
  if (!audioContext) audioContext = new AudioContext();
  if (audioContext.state === "suspended") void audioContext.resume();
  return audioContext;
}

function sendSignal(targetDeviceId: string, data: VoiceSignalPayload): void {
  getSocket().emit("voice:signal", { code: roomCode, deviceId: myDeviceId, targetDeviceId, data });
}

function attachAnalyser(stream: MediaStream): { analyser: AnalyserNode; dataArray: Uint8Array<ArrayBuffer> } | null {
  try {
    const ctx = ensureAudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    return { analyser, dataArray: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)) };
  } catch {
    return null;
  }
}

async function loadIceServers(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ICE_REQUEST_TIMEOUT_MS);
  try {
    const token = getAuthToken();
    const response = await fetch(`${API_BASE}/api/voice/ice`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as { iceServers?: unknown; turnAvailable?: unknown };
    if (!Array.isArray(data.iceServers) || data.iceServers.length === 0) throw new Error("No ICE servers");
    iceServers = data.iceServers as RTCIceServer[];
    turnAvailable = data.turnAvailable === true;
  } catch {
    iceServers = FALLBACK_ICE_SERVERS;
    turnAvailable = false;
  } finally {
    clearTimeout(timer);
  }
}

function shouldInitiate(targetDeviceId: string): boolean {
  return myDeviceId < targetDeviceId;
}

function applyAudioMute(targetDeviceId: string, entry: PeerEntry): void {
  entry.audioEl.muted = listeningMuted || mutedPeers.has(targetDeviceId);
}

async function playRemoteAudio(targetDeviceId: string, entry: PeerEntry): Promise<void> {
  applyAudioMute(targetDeviceId, entry);
  try {
    await entry.audioEl.play();
  } catch {
    playbackBlocked = true;
  }
}

function connectionStatus(entry: PeerEntry): PeerVoiceStatus {
  switch (entry.connection.connectionState) {
    case "connected":
      return "connected";
    case "disconnected":
      return "reconnecting";
    case "failed":
    case "closed":
      return "failed";
    default:
      return "connecting";
  }
}

function scheduleIceRestart(targetDeviceId: string, entry: PeerEntry): void {
  if (entry.restartTimer) return;
  entry.restartTimer = setTimeout(() => {
    entry.restartTimer = null;
    if (!desiredPeers.has(targetDeviceId) || entry.connection.connectionState === "connected") return;
    try {
      entry.connection.restartIce();
    } catch {
      disconnectPeer(targetDeviceId);
      void connectPeer(targetDeviceId);
    }
  }, DISCONNECTED_RESTART_MS);
}

async function makeOffer(targetDeviceId: string, entry: PeerEntry): Promise<void> {
  const pc = entry.connection;
  try {
    entry.makingOffer = true;
    await pc.setLocalDescription();
    if (pc.localDescription) {
      sendSignal(targetDeviceId, { type: "description", description: pc.localDescription.toJSON() });
    }
  } catch {
    scheduleIceRestart(targetDeviceId, entry);
  } finally {
    entry.makingOffer = false;
  }
}

async function attachLocalTrack(entry: PeerEntry): Promise<void> {
  const track = localStream?.getAudioTracks()[0];
  if (!track || entry.connection.signalingState === "closed") return;

  const transceiver = entry.connection.getTransceivers().find((item) => item.receiver.track.kind === "audio");
  if (!transceiver || transceiver.sender.track?.id === track.id) return;
  transceiver.direction = "sendrecv";
  await transceiver.sender.replaceTrack(track);
}

function createPeerConnection(targetDeviceId: string): PeerEntry {
  const pc = new RTCPeerConnection({ iceServers });
  const audioEl = document.createElement("audio");
  audioEl.autoplay = true;
  audioEl.setAttribute("playsinline", "");
  audioEl.style.display = "none";
  audioEl.dataset.voicePeer = targetDeviceId;
  document.body.appendChild(audioEl);

  const entry: PeerEntry = {
    connection: pc,
    audioEl,
    analyser: null,
    dataArray: null,
    polite: myDeviceId > targetDeviceId,
    makingOffer: false,
    ignoreOffer: false,
    isSettingRemoteAnswerPending: false,
    pendingCandidates: [],
    restartTimer: null,
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) sendSignal(targetDeviceId, { type: "ice", candidate: event.candidate.toJSON() });
  };

  pc.ontrack = (event) => {
    const stream = event.streams[0] ?? new MediaStream([event.track]);
    entry.audioEl.srcObject = stream;
    const analysed = attachAnalyser(stream);
    if (analysed) {
      entry.analyser = analysed.analyser;
      entry.dataArray = analysed.dataArray;
    }
    void playRemoteAudio(targetDeviceId, entry);
  };

  pc.onnegotiationneeded = () => void makeOffer(targetDeviceId, entry);
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      if (entry.restartTimer) clearTimeout(entry.restartTimer);
      entry.restartTimer = null;
    } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
      scheduleIceRestart(targetDeviceId, entry);
    }
  };

  peers.set(targetDeviceId, entry);

  if (shouldInitiate(targetDeviceId)) {
    const track = localStream?.getAudioTracks()[0];
    if (track && localStream) {
      pc.addTransceiver(track, { direction: "sendrecv", streams: [localStream] });
    } else {
      // A full-duplex audio channel is negotiated before either microphone is on.
      // replaceTrack() can then start sending later without creating one-way audio.
      pc.addTransceiver("audio", { direction: "sendrecv" });
    }
  }

  return entry;
}

export async function connectPeer(targetDeviceId: string): Promise<void> {
  if (!sessionReady || peers.has(targetDeviceId) || targetDeviceId === myDeviceId) return;
  createPeerConnection(targetDeviceId);
}

export function disconnectPeer(targetDeviceId: string): void {
  const entry = peers.get(targetDeviceId);
  if (!entry) return;
  if (entry.restartTimer) clearTimeout(entry.restartTimer);
  entry.connection.close();
  entry.audioEl.srcObject = null;
  entry.audioEl.remove();
  peers.delete(targetDeviceId);
}

async function flushPendingCandidates(entry: PeerEntry): Promise<void> {
  const pending = entry.pendingCandidates.splice(0);
  for (const candidate of pending) {
    try {
      await entry.connection.addIceCandidate(candidate);
    } catch {
      // A candidate can become obsolete after glare rollback or an ICE restart.
    }
  }
}

export async function handleSignal(fromDeviceId: string, data: VoiceSignalPayload): Promise<void> {
  if (!sessionReady) {
    earlySignals.push({ deviceId: fromDeviceId, data });
    return;
  }
  // The server already verifies both devices belong to this room. Accepting the first
  // signal also covers the tiny race where it arrives before React renders room:state.
  desiredPeers.add(fromDeviceId);
  if (!peers.has(fromDeviceId)) createPeerConnection(fromDeviceId);
  const entry = peers.get(fromDeviceId);
  if (!entry) return;
  const pc = entry.connection;

  try {
    if (data.type === "description") {
      const description = data.description;
      const readyForOffer =
        !entry.makingOffer && (pc.signalingState === "stable" || entry.isSettingRemoteAnswerPending);
      const offerCollision = description.type === "offer" && !readyForOffer;
      entry.ignoreOffer = !entry.polite && offerCollision;
      if (entry.ignoreOffer) return;

      entry.isSettingRemoteAnswerPending = description.type === "answer";
      await pc.setRemoteDescription(description);
      entry.isSettingRemoteAnswerPending = false;
      await flushPendingCandidates(entry);

      if (description.type === "offer") {
        await attachLocalTrack(entry);
        await pc.setLocalDescription();
        if (pc.localDescription) {
          sendSignal(fromDeviceId, { type: "description", description: pc.localDescription.toJSON() });
        }
      }
    } else if (pc.remoteDescription) {
      await pc.addIceCandidate(data.candidate);
    } else {
      entry.pendingCandidates.push(data.candidate);
    }
  } catch {
    if (!entry.ignoreOffer) scheduleIceRestart(fromDeviceId, entry);
  }
}

function closeAllPeers(): void {
  for (const deviceId of [...peers.keys()]) disconnectPeer(deviceId);
}

function reconcilePeers(): void {
  if (!sessionReady || !getSocket().connected) return;
  for (const id of [...peers.keys()]) {
    if (!desiredPeers.has(id)) disconnectPeer(id);
  }
  for (const id of desiredPeers) void connectPeer(id);
}

export async function initVoiceSession(code: string, deviceId: string): Promise<void> {
  teardownAll();
  const generation = sessionGeneration;
  roomCode = code;
  myDeviceId = deviceId;

  const socket = getSocket();
  signalHandler = (payload) => void handleSignal(payload.deviceId, payload.data);
  socketConnectHandler = () => {
    closeAllPeers();
    reconcilePeers();
  };
  socketDisconnectHandler = () => closeAllPeers();
  socket.on("voice:signal", signalHandler);
  socket.on("connect", socketConnectHandler);
  socket.on("disconnect", socketDisconnectHandler);

  await loadIceServers();
  if (generation !== sessionGeneration) return;
  sessionReady = true;
  reconcilePeers();
  for (const pending of earlySignals.splice(0)) {
    await handleSignal(pending.deviceId, pending.data);
  }
}

export function setDesiredPeers(deviceIds: string[]): void {
  desiredPeers.clear();
  for (const id of deviceIds) {
    if (id !== myDeviceId) desiredPeers.add(id);
  }
  for (const id of [...mutedPeers]) {
    if (!desiredPeers.has(id)) mutedPeers.delete(id);
  }
  reconcilePeers();
}

export async function startLocalMic(): Promise<void> {
  if (localStream) return;
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const analysed = attachAnalyser(localStream);
  if (analysed) {
    localAnalyser = analysed.analyser;
    localDataArray = analysed.dataArray;
  }

  for (const [targetDeviceId, entry] of peers) {
    if (!shouldInitiate(targetDeviceId) && !entry.connection.remoteDescription) continue;
    await attachLocalTrack(entry);
  }
}

export function setMicMuted(muted: boolean): void {
  if (!localStream) return;
  for (const track of localStream.getAudioTracks()) track.enabled = !muted;
}

export function setListeningMuted(muted: boolean): void {
  listeningMuted = muted;
  for (const [deviceId, entry] of peers) {
    applyAudioMute(deviceId, entry);
    if (!muted) void playRemoteAudio(deviceId, entry);
  }
}

export function setPeerMuted(deviceId: string, muted: boolean): void {
  if (muted) mutedPeers.add(deviceId);
  else mutedPeers.delete(deviceId);
  const entry = peers.get(deviceId);
  if (entry) {
    applyAudioMute(deviceId, entry);
    if (!muted) void playRemoteAudio(deviceId, entry);
  }
}

export async function resumeAudioPlayback(): Promise<void> {
  playbackBlocked = false;
  ensureAudioContext();
  await Promise.allSettled([...peers].map(([deviceId, entry]) => playRemoteAudio(deviceId, entry)));
}

export function getSnapshot(): VoiceEngineSnapshot {
  const speakingLevels = new Map<string, number>();
  if (localAnalyser && localDataArray) {
    localAnalyser.getByteFrequencyData(localDataArray);
    speakingLevels.set(myDeviceId, average(localDataArray));
  }
  const peerStatuses = new Map<string, PeerVoiceStatus>();
  for (const [deviceId, entry] of peers) {
    peerStatuses.set(deviceId, connectionStatus(entry));
    if (!entry.analyser || !entry.dataArray) continue;
    entry.analyser.getByteFrequencyData(entry.dataArray);
    speakingLevels.set(deviceId, average(entry.dataArray));
  }
  return { speakingLevels, peerStatuses, playbackBlocked, turnAvailable };
}

function average(data: Uint8Array<ArrayBuffer>): number {
  let sum = 0;
  for (const value of data) sum += value;
  return sum / data.length;
}

export function teardownAll(): void {
  sessionGeneration += 1;
  sessionReady = false;
  const socket = getSocket();
  if (signalHandler) socket.off("voice:signal", signalHandler);
  if (socketConnectHandler) socket.off("connect", socketConnectHandler);
  if (socketDisconnectHandler) socket.off("disconnect", socketDisconnectHandler);
  signalHandler = null;
  socketConnectHandler = null;
  socketDisconnectHandler = null;
  closeAllPeers();
  desiredPeers.clear();
  mutedPeers.clear();
  earlySignals.length = 0;
  if (localStream) {
    for (const track of localStream.getTracks()) track.stop();
    localStream = null;
  }
  localAnalyser = null;
  localDataArray = null;
  playbackBlocked = false;
  listeningMuted = false;
}
