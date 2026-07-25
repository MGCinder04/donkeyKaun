import { getSocket } from "../rooms/socket";

// Public STUN only (free, no signup) — enough for most home networks to find a direct
// path. No TURN relay is configured (that needs paid, hosted infrastructure), so voice
// can fail to connect for players behind strict/symmetric NATs — most common on some
// mobile carriers or locked-down corporate networks. Everyone else should be fine.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

type VoiceSignalPayload =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "ice"; candidate: RTCIceCandidateInit };

interface PeerEntry {
  connection: RTCPeerConnection;
  audioEl: HTMLAudioElement;
  analyser: AnalyserNode | null;
  dataArray: Uint8Array<ArrayBuffer> | null;
}

let localStream: MediaStream | null = null;
let myDeviceId = "";
let roomCode = "";
let audioContext: AudioContext | null = null;
let signalHandlerAttached = false;
let localAnalyser: AnalyserNode | null = null;
let localDataArray: Uint8Array<ArrayBuffer> | null = null;
const peers = new Map<string, PeerEntry>();

function ensureAudioContext(): AudioContext {
  if (!audioContext) audioContext = new AudioContext();
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
    return null; // non-fatal — that peer just won't get a speaking indicator
  }
}

function createPeerConnection(targetDeviceId: string): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  if (localStream) {
    for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) sendSignal(targetDeviceId, { type: "ice", candidate: e.candidate.toJSON() });
  };

  pc.ontrack = (e) => {
    const entry = peers.get(targetDeviceId);
    if (!entry) return;
    entry.audioEl.srcObject = e.streams[0];
    entry.audioEl.play().catch(() => {});
    const analysed = attachAnalyser(e.streams[0]);
    if (analysed) {
      entry.analyser = analysed.analyser;
      entry.dataArray = analysed.dataArray;
    }
  };

  return pc;
}

/** Deterministic initiator so both sides don't send offers at once — the lower deviceId
 *  always offers, the other always answers. */
function shouldInitiate(targetDeviceId: string): boolean {
  return myDeviceId < targetDeviceId;
}

export function connectPeer(targetDeviceId: string): void {
  if (peers.has(targetDeviceId) || targetDeviceId === myDeviceId) return;
  const audioEl = document.createElement("audio");
  audioEl.autoplay = true;
  audioEl.style.display = "none";
  document.body.appendChild(audioEl);

  const connection = createPeerConnection(targetDeviceId);
  peers.set(targetDeviceId, { connection, audioEl, analyser: null, dataArray: null });

  if (shouldInitiate(targetDeviceId)) {
    connection
      .createOffer()
      .then((offer) => connection.setLocalDescription(offer).then(() => offer))
      .then((offer) => sendSignal(targetDeviceId, { type: "offer", sdp: offer.sdp ?? "" }))
      .catch(() => {});
  }
}

export function disconnectPeer(targetDeviceId: string): void {
  const entry = peers.get(targetDeviceId);
  if (!entry) return;
  entry.connection.close();
  entry.audioEl.srcObject = null;
  entry.audioEl.remove();
  peers.delete(targetDeviceId);
}

export async function handleSignal(fromDeviceId: string, data: VoiceSignalPayload): Promise<void> {
  if (!peers.has(fromDeviceId)) connectPeer(fromDeviceId);
  const entry = peers.get(fromDeviceId);
  if (!entry) return;
  const pc = entry.connection;

  try {
    if (data.type === "offer") {
      await pc.setRemoteDescription({ type: "offer", sdp: data.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal(fromDeviceId, { type: "answer", sdp: answer.sdp ?? "" });
    } else if (data.type === "answer") {
      await pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
    } else if (data.type === "ice") {
      await pc.addIceCandidate(data.candidate);
    }
  } catch {
    // Benign in a few races (e.g. an ICE candidate arriving before the remote
    // description is set) — the connection typically still completes.
  }
}

export function initVoiceSession(code: string, deviceId: string): void {
  roomCode = code;
  myDeviceId = deviceId;
  if (signalHandlerAttached) return;
  signalHandlerAttached = true;
  getSocket().on("voice:signal", (payload: { deviceId: string; data: VoiceSignalPayload }) => {
    handleSignal(payload.deviceId, payload.data);
  });
}

export async function startLocalMic(): Promise<void> {
  if (localStream) return;
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const analysed = attachAnalyser(localStream);
  if (analysed) {
    localAnalyser = analysed.analyser;
    localDataArray = analysed.dataArray;
  }
  for (const entry of peers.values()) {
    for (const track of localStream.getTracks()) entry.connection.addTrack(track, localStream);
  }
}

export function setMuted(muted: boolean): void {
  if (!localStream) return;
  for (const track of localStream.getAudioTracks()) track.enabled = !muted;
}

export function getSpeakingLevels(): Map<string, number> {
  const levels = new Map<string, number>();
  if (localAnalyser && localDataArray) {
    localAnalyser.getByteFrequencyData(localDataArray);
    levels.set(myDeviceId, average(localDataArray));
  }
  for (const [deviceId, entry] of peers) {
    if (!entry.analyser || !entry.dataArray) continue;
    entry.analyser.getByteFrequencyData(entry.dataArray);
    levels.set(deviceId, average(entry.dataArray));
  }
  return levels;
}

function average(data: Uint8Array<ArrayBuffer>): number {
  let sum = 0;
  for (const v of data) sum += v;
  return sum / data.length;
}

export function teardownAll(): void {
  for (const deviceId of [...peers.keys()]) disconnectPeer(deviceId);
  if (localStream) {
    for (const track of localStream.getTracks()) track.stop();
    localStream = null;
  }
  localAnalyser = null;
  localDataArray = null;
}
