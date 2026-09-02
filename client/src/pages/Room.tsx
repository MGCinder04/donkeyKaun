import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import QRCode from "qrcode";
import { Button } from "../components/Button";
import { Seat } from "../components/Seat";
import { GameTable } from "../components/GameTable";
import { VoiceControl } from "../components/VoiceControl";
import { useVoiceChat } from "../voice/useVoiceChat";
import { useIdentity, hasCompleteProfile } from "../identity/useIdentity";
import {
  continueGame,
  exitGame,
  joinRoom,
  kickPlayer,
  leaveRoom,
  newGame,
  onHand,
  onKicked,
  onRoomExited,
  onRoomState,
  placeBid,
  playCard,
  startRoom,
} from "../rooms/roomClient";
import { seatPosition } from "../rooms/seatLayout";
import { ROOM_ERROR_MESSAGES } from "../rooms/errorMessages";
import { useConnectionStatus } from "../rooms/useConnectionStatus";
import type { Card, PublicRoom } from "../rooms/types";

const SEAT_COUNT = 6;
const MIN_TO_START = 2;

type ViewState = "joining" | "joined" | "error" | "kicked" | "exited";

export function Room() {
  const navigate = useNavigate();
  const { code = "" } = useParams();
  const roomCode = code.toUpperCase();
  const identity = useIdentity();

  const [view, setView] = useState<ViewState>("joining");
  const [errorMessage, setErrorMessage] = useState("");
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [inviteUrl] = useState(() => `${window.location.origin}/room/${roomCode}`);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [hand, setHand] = useState<Card[]>([]);
  const [legalCards, setLegalCards] = useState<Card[]>([]);
  const joinedRef = useRef(false);
  const connected = useConnectionStatus();

  useEffect(() => {
    if (!hasCompleteProfile(identity)) {
      navigate(`/setup?next=room&code=${roomCode}`, { replace: true });
      return;
    }
    if (joinedRef.current) return;
    joinedRef.current = true;

    joinRoom(roomCode, identity.name, identity.avatar!, identity.deviceId).then((result) => {
      if (result.ok) {
        setRoom(result.value);
        setView("joined");
      } else {
        setErrorMessage(ROOM_ERROR_MESSAGES[result.error] ?? "Couldn't join that room.");
        setView("error");
      }
    });
  }, [identity, navigate, roomCode]);

  useEffect(() => onRoomState((incoming) => {
    if (incoming.code === roomCode) setRoom(incoming);
  }), [roomCode]);

  useEffect(() => onKicked((kickedCode) => {
    if (kickedCode === roomCode) setView("kicked");
  }), [roomCode]);

  useEffect(() => onRoomExited((exitedCode) => {
    if (exitedCode === roomCode) setView("exited");
  }), [roomCode]);

  useEffect(() => onHand((incoming) => {
    setHand(incoming.hand);
    setLegalCards(incoming.legalCards);
  }), []);

  useEffect(() => {
    QRCode.toDataURL(inviteUrl, { margin: 1, width: 176, color: { dark: "#17281f", light: "#f4eedf" } }).then(
      setQrDataUrl,
    );
  }, [inviteUrl]);

  const peerDeviceIds =
    room?.players.filter((p) => p.connected && p.deviceId !== identity.deviceId).map((p) => p.deviceId) ?? [];
  const voiceState = useVoiceChat(roomCode, identity.deviceId, peerDeviceIds);

  function handleCopy() {
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleStart() {
    setStarting(true);
    const result = await startRoom(roomCode, identity.deviceId);
    setStarting(false);
    if (!result.ok) {
      setErrorMessage(ROOM_ERROR_MESSAGES[result.error] ?? "Couldn't start the game.");
    }
  }

  async function handleKick(targetDeviceId: string, targetName: string) {
    if (!window.confirm(`Remove ${targetName} from the room?`)) return;
    await kickPlayer(roomCode, identity.deviceId, targetDeviceId);
  }

  function handleLeave() {
    leaveRoom(roomCode, identity.deviceId);
    navigate("/");
  }

  if (view === "joining") {
    return (
      <section className="mx-auto max-w-md px-6 pt-24 pb-16 text-center">
        <p style={{ color: "var(--ink-dim)" }}>Joining room {roomCode}…</p>
      </section>
    );
  }

  if (view === "kicked") {
    return (
      <section className="mx-auto max-w-md px-6 pt-24 pb-16 text-center">
        <h2 className="text-2xl font-bold sm:text-3xl">Removed from the room</h2>
        <p className="mt-3" style={{ color: "var(--ink-dim)" }}>
          The host removed you from this room.
        </p>
        <div className="mt-8 flex justify-center gap-4">
          <Button variant="ghost" onClick={() => navigate("/")}>
            Back home
          </Button>
        </div>
      </section>
    );
  }

  if (view === "exited") {
    return (
      <section className="mx-auto max-w-md px-6 pt-24 pb-16 text-center">
        <h2 className="text-2xl font-bold sm:text-3xl">Session ended</h2>
        <p className="mt-3" style={{ color: "var(--ink-dim)" }}>
          The host ended this game.
        </p>
        <div className="mt-8 flex justify-center gap-4">
          <Button variant="ghost" onClick={() => navigate("/")}>
            Back home
          </Button>
        </div>
      </section>
    );
  }

  if (view === "error" || !room) {
    return (
      <section className="mx-auto max-w-md px-6 pt-24 pb-16 text-center">
        <h2 className="text-2xl font-bold sm:text-3xl">Can't join this room</h2>
        <p className="mt-3" style={{ color: "var(--ink-dim)" }}>
          {errorMessage}
        </p>
        <div className="mt-8 flex justify-center gap-4">
          <Button variant="ghost" onClick={() => navigate("/")}>
            Back home
          </Button>
        </div>
      </section>
    );
  }

  const self = room.players.find((p) => p.deviceId === identity.deviceId);
  const isHost = self?.isHost ?? false;
  const canStart = room.players.length >= MIN_TO_START && room.players.length <= SEAT_COUNT;

  return (
    <section className="mx-auto max-w-3xl px-6 pt-16 pb-16">
      {!connected && (
        <div
          className="fixed inset-x-0 bottom-0 z-[60] py-1.5 text-center text-xs font-semibold"
          style={{ background: "var(--brick)", color: "var(--ground)" }}
        >
          Reconnecting…
        </div>
      )}
      <div className="mb-10 text-center">
        <p
          className="mb-2 text-xs font-semibold uppercase"
          style={{ color: "var(--gold)", letterSpacing: "0.16em" }}
        >
          {room.status === "playing" ? "Game in progress" : "Lobby"}
        </p>
        <h2 className="text-2xl font-bold sm:text-3xl">
          {room.players.length} of {SEAT_COUNT} players
        </h2>
      </div>

      <VoiceControl state={voiceState} />

      {room.status !== "playing" && (
        <>
          <div className="relative mx-auto mb-10 h-[340px] max-w-xl">
            <div
              className="absolute inset-[10%] rounded-full border"
              style={{ borderColor: "var(--hairline)", background: "radial-gradient(ellipse at center, var(--ground-raised-2), var(--ground-raised) 75%)" }}
            />
            {Array.from({ length: SEAT_COUNT }, (_, i) => {
              const player = room.players[i];
              const isSelf = player?.deviceId === identity.deviceId;
              return (
                <Seat
                  key={player?.deviceId ?? `open-${i}`}
                  player={player}
                  position={seatPosition(i, SEAT_COUNT)}
                  isSelf={isSelf}
                  onClickSelf={isSelf ? () => navigate("/setup") : undefined}
                  onKick={
                    player && !isSelf && isHost ? () => handleKick(player.deviceId, player.name) : undefined
                  }
                  speaking={player ? voiceState.speakingDeviceIds.has(player.deviceId) : false}
                  voiceMuted={player ? voiceState.mutedPeerIds.has(player.deviceId) : false}
                  onToggleVoiceMute={
                    player && !isSelf ? () => voiceState.togglePeerMute(player.deviceId) : undefined
                  }
                />
              );
            })}
          </div>

          <div className="mx-auto mb-10 grid max-w-md gap-4 rounded-2xl border p-6 text-center sm:grid-cols-[1fr_auto]" style={{ background: "var(--ground-raised)", borderColor: "var(--hairline)" }}>
            <div className="flex flex-col items-center gap-4">
              <div
                className="rounded-lg px-4 py-3 text-2xl font-semibold"
                style={{
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.18em",
                  color: "var(--gold-bright)",
                  background: "var(--ground-raised-2)",
                  border: "1px dashed var(--hairline)",
                }}
              >
                {roomCode}
              </div>
              <Button variant="ghost" onClick={handleCopy} className="w-full">
                {copied ? "Copied!" : "Copy Invite Link"}
              </Button>
            </div>
            {qrDataUrl && (
              <img src={qrDataUrl} width={110} height={110} alt="QR code to join this room" className="mx-auto rounded-lg" />
            )}
          </div>
        </>
      )}

      {room.status === "playing" && room.game ? (
        <GameTable
          game={room.game}
          players={room.players}
          hand={hand}
          legalCards={legalCards}
          myDeviceId={identity.deviceId}
          isHost={isHost}
          onBid={(bid) => placeBid(roomCode, identity.deviceId, bid)}
          onPlay={(card) => playCard(roomCode, identity.deviceId, card)}
          onNewGame={() => newGame(roomCode, identity.deviceId)}
          onContinue={() => continueGame(roomCode, identity.deviceId)}
          onExit={() => exitGame(roomCode, identity.deviceId)}
          speakingDeviceIds={voiceState.speakingDeviceIds}
          mutedVoiceDeviceIds={voiceState.mutedPeerIds}
          onToggleVoiceMute={voiceState.togglePeerMute}
        />
      ) : isHost ? (
        <div className="text-center">
          <Button variant="primary" disabled={!canStart || starting} onClick={handleStart}>
            {starting ? "Starting…" : `Start Game (${room.players.length})`}
          </Button>
          {!canStart && (
            <p className="mt-2 text-sm" style={{ color: "var(--ink-faint)" }}>
              Need at least {MIN_TO_START} players to start.
            </p>
          )}
        </div>
      ) : (
        <p className="text-center" style={{ color: "var(--ink-dim)" }}>
          Waiting for the host to start the game…
        </p>
      )}

      <div className="mt-10 text-center">
        <Button variant="ghost" onClick={handleLeave}>
          Leave room
        </Button>
      </div>
    </section>
  );
}
