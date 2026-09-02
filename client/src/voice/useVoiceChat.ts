import { useEffect, useRef, useState } from "react";
import * as voice from "./webrtcEngine";
import type { PeerVoiceStatus } from "./webrtcEngine";

const SPEAKING_THRESHOLD = 14;
const POLL_MS = 200;

export interface VoiceChatState {
  micEnabled: boolean;
  micPending: boolean;
  micError: string | null;
  micMuted: boolean;
  listeningMuted: boolean;
  playbackBlocked: boolean;
  turnAvailable: boolean;
  connectedPeerCount: number;
  peerCount: number;
  peerStatuses: Map<string, PeerVoiceStatus>;
  mutedPeerIds: Set<string>;
  speakingDeviceIds: Set<string>;
  enableMic: () => void;
  toggleMicMute: () => void;
  toggleListeningMute: () => void;
  togglePeerMute: (deviceId: string) => void;
  resumeAudio: () => void;
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((id) => right.has(id));
}

function sameStatusMap(left: Map<string, PeerVoiceStatus>, right: Map<string, PeerVoiceStatus>): boolean {
  return left.size === right.size && [...left].every(([id, status]) => right.get(id) === status);
}

/**
 * Listening starts automatically and never requests microphone permission. Turning on
 * the microphone only controls whether this player also transmits. Every connected room
 * member gets a pre-negotiated receive channel, so click order cannot cause one-way audio.
 */
export function useVoiceChat(roomCode: string, myDeviceId: string, peerDeviceIds: string[]): VoiceChatState {
  const [sessionReady, setSessionReady] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [micPending, setMicPending] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [listeningMuted, setListeningMuted] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [turnAvailable, setTurnAvailable] = useState(false);
  const [peerStatuses, setPeerStatuses] = useState<Map<string, PeerVoiceStatus>>(new Map());
  const [mutedPeerIds, setMutedPeerIds] = useState<Set<string>>(new Set());
  const [speakingDeviceIds, setSpeakingDeviceIds] = useState<Set<string>>(new Set());
  const micEnabledRef = useRef(micEnabled);
  const latestPeersRef = useRef(peerDeviceIds);
  micEnabledRef.current = micEnabled;
  latestPeersRef.current = peerDeviceIds;

  useEffect(() => {
    let cancelled = false;
    setSessionReady(false);
    void voice.initVoiceSession(roomCode, myDeviceId).then(() => {
      if (cancelled) return;
      voice.setDesiredPeers(latestPeersRef.current);
      setSessionReady(true);
    });
    return () => {
      cancelled = true;
      voice.teardownAll();
    };
  }, [roomCode, myDeviceId]);

  const peerKey = [...peerDeviceIds].sort().join(",");
  useEffect(() => {
    if (sessionReady) voice.setDesiredPeers(latestPeersRef.current);
  }, [sessionReady, peerKey]);

  useEffect(() => {
    if (!sessionReady) return;
    const update = () => {
      const snapshot = voice.getSnapshot();
      const speaking = new Set<string>();
      for (const [id, level] of snapshot.speakingLevels) {
        if (level > SPEAKING_THRESHOLD) speaking.add(id);
      }
      setSpeakingDeviceIds((previous) => (sameSet(previous, speaking) ? previous : speaking));
      setPeerStatuses((previous) =>
        sameStatusMap(previous, snapshot.peerStatuses) ? previous : snapshot.peerStatuses,
      );
      setPlaybackBlocked(snapshot.playbackBlocked);
      setTurnAvailable(snapshot.turnAvailable);
    };
    update();
    const timer = setInterval(update, POLL_MS);
    return () => clearInterval(timer);
  }, [sessionReady]);

  function enableMic() {
    if (micEnabledRef.current || micPending) return;
    setMicPending(true);
    setMicError(null);
    voice
      .startLocalMic()
      .then(() => {
        setMicEnabled(true);
        setMicPending(false);
      })
      .catch(() => {
        setMicPending(false);
        setMicError("Couldn't access your microphone. Check your browser's permission settings.");
      });
  }

  function toggleMicMute() {
    setMicMuted((previous) => {
      const next = !previous;
      voice.setMicMuted(next);
      return next;
    });
  }

  function toggleListeningMute() {
    setListeningMuted((previous) => {
      const next = !previous;
      voice.setListeningMuted(next);
      return next;
    });
  }

  function togglePeerMute(deviceId: string) {
    setMutedPeerIds((previous) => {
      const next = new Set(previous);
      const muted = !next.has(deviceId);
      if (muted) next.add(deviceId);
      else next.delete(deviceId);
      voice.setPeerMuted(deviceId, muted);
      return next;
    });
  }

  function resumeAudio() {
    void voice.resumeAudioPlayback().then(() => setPlaybackBlocked(voice.getSnapshot().playbackBlocked));
  }

  const connectedPeerCount = [...peerStatuses.values()].filter((status) => status === "connected").length;

  return {
    micEnabled,
    micPending,
    micError,
    micMuted,
    listeningMuted,
    playbackBlocked,
    turnAvailable,
    connectedPeerCount,
    peerCount: peerDeviceIds.length,
    peerStatuses,
    mutedPeerIds,
    speakingDeviceIds,
    enableMic,
    toggleMicMute,
    toggleListeningMute,
    togglePeerMute,
    resumeAudio,
  };
}
