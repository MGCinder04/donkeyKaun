import { useEffect, useRef, useState } from "react";
import * as voice from "./webrtcEngine";

const SPEAKING_THRESHOLD = 14; // empirical — byte-frequency average, 0-255 scale
const POLL_MS = 150;

export interface VoiceChatState {
  micEnabled: boolean;
  micPending: boolean;
  micError: string | null;
  muted: boolean;
  speakingDeviceIds: Set<string>;
  enableMic: () => void;
  toggleMute: () => void;
}

/** Voice chat is entirely opt-in: nothing connects (no mic prompt, no peer connections)
 *  until the player explicitly enables it. `peerDeviceIds` should be every other
 *  currently-connected player in the room — this hook diffs it against the previous
 *  render to connect new peers and tear down ones who've left. */
export function useVoiceChat(roomCode: string, myDeviceId: string, peerDeviceIds: string[]): VoiceChatState {
  const [micEnabled, setMicEnabled] = useState(false);
  const [micPending, setMicPending] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [speakingDeviceIds, setSpeakingDeviceIds] = useState<Set<string>>(new Set());
  const micEnabledRef = useRef(micEnabled);
  const prevPeersRef = useRef<Set<string>>(new Set());
  micEnabledRef.current = micEnabled;

  useEffect(() => {
    voice.initVoiceSession(roomCode, myDeviceId);
  }, [roomCode, myDeviceId]);

  useEffect(() => {
    if (!micEnabled) return;
    const next = new Set(peerDeviceIds);
    for (const id of next) {
      if (!prevPeersRef.current.has(id)) voice.connectPeer(id);
    }
    for (const id of prevPeersRef.current) {
      if (!next.has(id)) voice.disconnectPeer(id);
    }
    prevPeersRef.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micEnabled, peerDeviceIds.join(",")]);

  useEffect(
    () => () => {
      voice.teardownAll();
      prevPeersRef.current = new Set();
    },
    [roomCode],
  );

  useEffect(() => {
    if (!micEnabled) return;
    const timer = setInterval(() => {
      const levels = voice.getSpeakingLevels();
      setSpeakingDeviceIds((prev) => {
        const next = new Set<string>();
        for (const [id, level] of levels) {
          if (level > SPEAKING_THRESHOLD) next.add(id);
        }
        if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev;
        return next;
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [micEnabled]);

  function enableMic() {
    if (micEnabledRef.current || micPending) return;
    setMicPending(true);
    setMicError(null);
    voice
      .startLocalMic()
      .then(() => {
        setMicEnabled(true);
        setMicPending(false);
        for (const id of peerDeviceIds) voice.connectPeer(id);
        prevPeersRef.current = new Set(peerDeviceIds);
      })
      .catch(() => {
        setMicPending(false);
        setMicError("Couldn't access your microphone. Check your browser's permission settings.");
      });
  }

  function toggleMute() {
    setMuted((prev) => {
      const next = !prev;
      voice.setMuted(next);
      return next;
    });
  }

  return { micEnabled, micPending, micError, muted, speakingDeviceIds, enableMic, toggleMute };
}
