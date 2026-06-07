import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  advanceReview,
  ApiError,
  authorizeHost,
  createRoom,
  getSession,
  joinRoom,
  playAgain,
  saveOwnDraft,
  savePeerAnswer,
  saveReviewAnswer,
  startGame,
  submitOwnDraft,
  submitPeerAnswer
} from "./api";
import { createDefaultDraft, ensurePlacementLength, normalizeDraft, serializeDraftForAutosave } from "./draftUtils";
import { clearStoredSession, loadStoredSession, saveStoredSession } from "./storage";
import type {
  AnswerView,
  AuthoringDraft,
  SessionResponse,
  StoredSession,
  TierListDraftPayload
} from "./types";

type LandingMode = "landing" | "hostPassword" | "hostSetup" | "join";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function scorePercent(score: number) {
  return `${Math.round(score * 100)}%`;
}

function formatPhaseLabel(phase: SessionResponse["room"]["phase"]) {
  switch (phase) {
    case "lobby":
      return "Lobby";
    case "authoring":
      return "Authoring";
    case "peerAnswering":
      return "Peer Answering";
    case "review":
      return "Review";
    case "awards":
      return "Awards";
    default:
      return phase;
  }
}

function useDebouncedEffect(effect: () => void, delay: number, deps: unknown[]) {
  useEffect(() => {
    const timeout = window.setTimeout(effect, delay);
    return () => window.clearTimeout(timeout);
  }, deps);
}

function moveOption(placements: Array<number | null>, optionIndex: number, tierIndex: number | null) {
  const next = [...placements];
  next[optionIndex] = tierIndex;
  return next;
}

function shortOptionLabel(option: string, index: number) {
  const trimmed = option.trim();
  const body = trimmed.length > 18 ? `${trimmed.slice(0, 18)}...` : trimmed;
  return `${index + 1}. ${body || "Untitled"}`;
}

function StarList({
  starRating,
  onChange,
  disabled = false
}: {
  starRating: number | null;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="stars" role="radiogroup" aria-label="Star rating">
      {[1, 2, 3, 4, 5].map((value) => (
        <button
          key={value}
          type="button"
          className={`star ${starRating !== null && starRating >= value ? "selected" : ""}`}
          onClick={() => onChange(value)}
          disabled={disabled}
          aria-label={`${value} star${value === 1 ? "" : "s"}`}
        >
          {"\u2605"}
        </button>
      ))}
    </div>
  );
}

function TierBoardEditor({
  tiers,
  options,
  placements,
  onChange,
  readOnly,
  title,
  selectedPlayerName,
  eyebrowLabel
}: {
  tiers: string[];
  options: string[];
  placements: Array<number | null>;
  onChange?: (next: Array<number | null>) => void;
  readOnly?: boolean;
  title: string;
  selectedPlayerName?: string;
  eyebrowLabel?: string;
}) {
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number | null>(null);
  const safePlacements = useMemo(() => ensurePlacementLength(placements, options.length), [placements, options.length]);

  useEffect(() => {
    if (selectedOptionIndex !== null && selectedOptionIndex >= options.length) {
      setSelectedOptionIndex(null);
    }
  }, [options.length, selectedOptionIndex]);

  const selectedText = selectedOptionIndex !== null ? options[selectedOptionIndex] ?? "" : "";

  const assignOption = (tierIndex: number | null) => {
    if (readOnly || selectedOptionIndex === null || !onChange) {
      return;
    }
    onChange(moveOption(safePlacements, selectedOptionIndex, tierIndex));
  };

  return (
    <section className="panel board-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">{eyebrowLabel ?? (selectedPlayerName ? `${selectedPlayerName}'s answer` : "Tier board")}</p>
          <h3>{title}</h3>
        </div>
        {!readOnly && <p className="hint">Tap an option chip, then tap a tier row or the quick buttons below.</p>}
      </div>

      <div className="tier-board">
        {tiers.map((tier, tierIndex) => (
          <button
            key={`${tier}-${tierIndex}`}
            type="button"
            className="tier-row"
            onClick={() => assignOption(tierIndex)}
            disabled={readOnly || selectedOptionIndex === null}
          >
            <span className="tier-label">{tier}</span>
            <span className="tier-options">
              {options.map((option, optionIndex) =>
                safePlacements[optionIndex] === tierIndex ? (
                  <span
                    key={`${tier}-${optionIndex}`}
                    className={`option-chip ${selectedOptionIndex === optionIndex ? "selected" : ""}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setSelectedOptionIndex(optionIndex);
                    }}
                  >
                    {shortOptionLabel(option, optionIndex)}
                  </span>
                ) : null
              )}
            </span>
          </button>
        ))}
      </div>

      <div className="option-bank">
        <div className="option-bank-header">
          <h4>Unassigned / all options</h4>
          <button
            type="button"
            className="ghost-button"
            disabled={readOnly || selectedOptionIndex === null}
            onClick={() => assignOption(null)}
          >
            Move to unassigned
          </button>
        </div>
        <div className="option-grid">
          {options.map((option, optionIndex) => (
            <button
              type="button"
              key={`option-${optionIndex}`}
              className={`option-card ${selectedOptionIndex === optionIndex ? "selected" : ""}`}
              onClick={() => setSelectedOptionIndex(optionIndex)}
            >
              <span className="option-index">{optionIndex + 1}</span>
              <span className="option-text">{option.trim() || "Untitled option"}</span>
              <span className="option-tier">
                {safePlacements[optionIndex] === null ? "Unassigned" : `In ${tiers[safePlacements[optionIndex]!]}`}
              </span>
            </button>
          ))}
        </div>
      </div>

      {selectedOptionIndex !== null && (
        <div className="assignment-sheet">
          <div>
            <p className="eyebrow">Selected option</p>
            <h4>{shortOptionLabel(selectedText, selectedOptionIndex)}</h4>
            <p>{selectedText.trim() || "This option does not have text yet."}</p>
          </div>
          {!readOnly && (
            <div className="assignment-actions">
              {tiers.map((tier, tierIndex) => (
                <button key={tier} type="button" className="tier-assign-button" onClick={() => assignOption(tierIndex)}>
                  {tier}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function AppContent() {
  const [mode, setMode] = useState<LandingMode>("landing");
  const [session, setSession] = useState<StoredSession | null>(null);
  const [sessionData, setSessionData] = useState<SessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hostPassword, setHostPassword] = useState("");
  const [hostUsername, setHostUsername] = useState("");
  const [hostPlayerCount, setHostPlayerCount] = useState(6);
  const [joinRoomCode, setJoinRoomCode] = useState("");
  const [joinUsername, setJoinUsername] = useState("");
  const [authoringDraft, setAuthoringDraft] = useState<AuthoringDraft>(createDefaultDraft());
  const [peerAnswerDraft, setPeerAnswerDraft] = useState<Pick<AnswerView, "placements" | "starRating">>({
    placements: [],
    starRating: null
  });
  const [reviewPlayerId, setReviewPlayerId] = useState<string>("");
  const [reviewAnswerDraft, setReviewAnswerDraft] = useState<Pick<AnswerView, "placements" | "starRating">>({
    placements: [],
    starRating: null
  });
  const socketRef = useRef<Socket | null>(null);
  const authoringDirtyRef = useRef(false);
  const peerDirtyRef = useRef(false);
  const reviewDirtyRef = useRef(false);
  const activePeerAuthorIdRef = useRef<string | null>(null);
  const activeReviewAuthorIdRef = useRef<string | null>(null);

  const updateAuthoringDraft = (updater: (draft: AuthoringDraft) => AuthoringDraft) => {
    authoringDirtyRef.current = true;
    setAuthoringDraft((currentDraft) => ({
      ...updater(currentDraft),
      updatedAt: Date.now()
    }));
  };

  const updatePeerAnswerDraft = (
    updater: (draft: Pick<AnswerView, "placements" | "starRating">) => Pick<AnswerView, "placements" | "starRating">
  ) => {
    peerDirtyRef.current = true;
    setPeerAnswerDraft((currentDraft) => updater(currentDraft));
  };

  const updateReviewAnswerDraft = (
    updater: (draft: Pick<AnswerView, "placements" | "starRating">) => Pick<AnswerView, "placements" | "starRating">
  ) => {
    reviewDirtyRef.current = true;
    setReviewAnswerDraft((currentDraft) => updater(currentDraft));
  };

  const refreshSession = async (candidate = session) => {
    if (!candidate) {
      setSessionData(null);
      return;
    }

    try {
      const nextSession = await getSession(candidate);
      setSessionData(nextSession);
      setError(null);
    } catch (caughtError) {
      clearStoredSession();
      setSession(null);
      setSessionData(null);
      if (caughtError instanceof ApiError) {
        setError(caughtError.message);
      } else {
        setError("Could not reconnect to your game.");
      }
    }
  };

  useEffect(() => {
    const existing = loadStoredSession();
    if (!existing) {
      setLoading(false);
      return;
    }

    setSession(existing);
    void refreshSession(existing).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!session) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }

    const socket = io("/", { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("room:subscribe", {
        roomCode: session.roomCode,
        playerToken: session.playerToken
      });
    });

    socket.on("room:state", () => {
      void refreshSession(session);
    });

    socket.on("room:error", (payload: { error: string }) => {
      setError(payload.error);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session?.playerToken, session?.roomCode]);

  useEffect(() => {
    if (sessionData?.view.kind === "authoring") {
      if (!authoringDirtyRef.current || sessionData.view.submitted) {
        setAuthoringDraft(sessionData.view.draft);
      }
    }
  }, [sessionData]);

  useEffect(() => {
    if (sessionData?.view.kind === "peerAnswering" && sessionData.view.answer) {
      const authorId = sessionData.view.currentList?.authorId ?? null;
      if (authorId !== activePeerAuthorIdRef.current) {
        activePeerAuthorIdRef.current = authorId;
        peerDirtyRef.current = false;
        setPeerAnswerDraft({
          placements: [...sessionData.view.answer.placements],
          starRating: sessionData.view.answer.starRating
        });
      } else if (!peerDirtyRef.current) {
        setPeerAnswerDraft({
          placements: [...sessionData.view.answer.placements],
          starRating: sessionData.view.answer.starRating
        });
      }
    }
  }, [sessionData]);

  useEffect(() => {
    if (sessionData?.view.kind === "review") {
      const reviewView = sessionData.view;
      const mine = reviewView.answerOptions.find((answer) => answer.playerId === reviewView.editablePlayerId);
      if (mine) {
        const authorId = reviewView.currentList.authorId;
        if (authorId !== activeReviewAuthorIdRef.current) {
          activeReviewAuthorIdRef.current = authorId;
          reviewDirtyRef.current = false;
          setReviewAnswerDraft({
            placements: [...mine.placements],
            starRating: mine.starRating
          });
          setReviewPlayerId(mine.playerId);
        } else if (!reviewDirtyRef.current) {
          setReviewAnswerDraft({
            placements: [...mine.placements],
            starRating: mine.starRating
          });
        }
      }
    }
  }, [sessionData]);

  useDebouncedEffect(
    () => {
      if (!session || !sessionData || sessionData.view.kind !== "authoring" || sessionData.view.submitted) {
        return;
      }

      const draftForAutosave = serializeDraftForAutosave(authoringDraft);
      if (draftForAutosave.options.length === 0 || draftForAutosave.tiers.length < 2) {
        return;
      }

      void saveOwnDraft(session, draftForAutosave)
        .then(() => {
          authoringDirtyRef.current = false;
        })
        .catch((caughtError) => {
          if (caughtError instanceof ApiError) {
            setError(caughtError.message);
          }
        });
    },
    600,
    [authoringDraft, session, sessionData]
  );

  useDebouncedEffect(
    () => {
      if (!session || !sessionData || sessionData.view.kind !== "peerAnswering" || !sessionData.view.currentList) {
        return;
      }
      void savePeerAnswer(session, sessionData.view.currentList.authorId, peerAnswerDraft)
        .then(() => {
          peerDirtyRef.current = false;
        })
        .catch((caughtError) => {
          if (caughtError instanceof ApiError) {
            setError(caughtError.message);
          }
        });
    },
    500,
    [peerAnswerDraft, session, sessionData]
  );

  useDebouncedEffect(
    () => {
      if (!session || !sessionData || sessionData.view.kind !== "review") {
        return;
      }
      void saveReviewAnswer(session, reviewAnswerDraft)
        .then(() => {
          reviewDirtyRef.current = false;
        })
        .catch((caughtError) => {
          if (caughtError instanceof ApiError) {
            setError(caughtError.message);
          }
        });
    },
    500,
    [reviewAnswerDraft, session, sessionData]
  );

  const persistNewSession = async (nextSession: StoredSession) => {
    saveStoredSession(nextSession);
    setSession(nextSession);
    await refreshSession(nextSession);
  };

  const handleHostAuthorization = async () => {
    setActionBusy(true);
    setError(null);
    try {
      await authorizeHost(hostPassword);
      setMode("hostSetup");
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Could not verify the host password.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleCreateRoom = async () => {
    setActionBusy(true);
    setError(null);
    try {
      const nextSession = await createRoom(hostUsername, hostPlayerCount);
      await persistNewSession(nextSession);
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Could not create room.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleJoinRoom = async () => {
    setActionBusy(true);
    setError(null);
    try {
      const nextSession = await joinRoom(joinRoomCode.toUpperCase(), joinUsername);
      await persistNewSession(nextSession);
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Could not join room.");
    } finally {
      setActionBusy(false);
    }
  };

  const runRoomAction = async (action: () => Promise<unknown>, event: string) => {
    if (!session) {
      return;
    }
    setActionBusy(true);
    setError(null);
    try {
      await action();
      await refreshSession(session);
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Something went wrong.");
    } finally {
      setActionBusy(false);
    }
  };

  const signOut = () => {
    clearStoredSession();
    authoringDirtyRef.current = false;
    peerDirtyRef.current = false;
    reviewDirtyRef.current = false;
    activePeerAuthorIdRef.current = null;
    activeReviewAuthorIdRef.current = null;
    setSession(null);
    setSessionData(null);
    setMode("landing");
    setHostPassword("");
    setJoinRoomCode("");
    setJoinUsername("");
    setError(null);
  };

  const currentReviewAnswer =
    sessionData?.view.kind === "review"
      ? sessionData.view.answerOptions.find((answer) => answer.playerId === reviewPlayerId) ?? sessionData.view.answerOptions[0]
      : null;
  const currentPeerList = sessionData?.view.kind === "peerAnswering" ? sessionData.view.currentList : null;

  if (loading) {
    return <div className="shell loading-shell">Reconnecting to your room...</div>;
  }

  if (!session || !sessionData) {
    return (
      <main className="shell landing-shell">
        <section className="hero-card landing-hero">
          <div className="hero-copy-column">
            <div className="hero-badges">
              <span className="hero-badge">Realtime party game</span>
              <span className="hero-badge muted">2-16 players</span>
            </div>
            <p className="eyebrow">Fast rooms. Big opinions.</p>
            <h1>The Tier List Game, now on mobile.</h1>
            <p className="hero-copy">Create a room, invite your friends, build your lists, and argue about the results live.</p>
            <div className="hero-actions">
              <button type="button" className="primary-button" onClick={() => setMode("hostPassword")}>
                Host Game
              </button>
              <button type="button" className="secondary-button" onClick={() => setMode("join")}>
                Join Game
              </button>
            </div>
            <p className="hero-note">Works great on phones and lets players reconnect if they drop.</p>
          </div>

          <aside className="hero-preview-card" aria-label="Game preview">
            <div className="preview-header">
              <div>
                <p className="eyebrow">Sample room</p>
                <h2>Best Snacks</h2>
              </div>
              <span className="pill accent">Live room</span>
            </div>
            <div className="preview-room-code">
              <span>Room code</span>
              <strong>J4XM</strong>
            </div>
            <div className="preview-board">
              <div className="preview-row s-tier">
                <span className="preview-tier-tag">S</span>
                <div className="preview-chip-row">
                  <span className="preview-chip">1. Fries</span>
                  <span className="preview-chip">4. Wings</span>
                </div>
              </div>
              <div className="preview-row a-tier">
                <span className="preview-tier-tag">A</span>
                <div className="preview-chip-row">
                  <span className="preview-chip">2. Nachos</span>
                  <span className="preview-chip">7. Cookies</span>
                </div>
              </div>
              <div className="preview-row b-tier">
                <span className="preview-tier-tag">B</span>
                <div className="preview-chip-row">
                  <span className="preview-chip">3. Pretzels</span>
                </div>
              </div>
            </div>
            <p className="preview-caption">One room, one code, and a shared debate once everyone is done.</p>
          </aside>
        </section>

        <section className="flow-card landing-flow-card">
          <div className="flow-card-header">
            <div>
              <p className="eyebrow">Start here</p>
              <h2>
                {mode === "landing" && "Choose what you want to do"}
                {mode === "hostPassword" && "Enter host password"}
                {mode === "hostSetup" && "Set up your room"}
                {mode === "join" && "Join a room"}
              </h2>
            </div>
            <span className="mode-pill">
              {mode === "landing" && "Overview"}
              {mode === "hostPassword" && "Host"}
              {mode === "hostSetup" && "Create"}
              {mode === "join" && "Join"}
            </span>
          </div>

          {mode === "landing" && (
            <div className="stack">
              <div className="route-grid">
                <button type="button" className="route-card route-card-primary" onClick={() => setMode("hostPassword")}>
                  <span className="route-icon">+</span>
                  <strong>Host a room</strong>
                  <p>Create the lobby and share the code.</p>
                </button>
                <button type="button" className="route-card" onClick={() => setMode("join")}>
                  <span className="route-icon">#</span>
                  <strong>Join a room</strong>
                  <p>Enter a code and jump in.</p>
                </button>
              </div>
            </div>
          )}

          {mode === "hostPassword" && (
            <div className="stack">
              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  value={hostPassword}
                  onChange={(event) => setHostPassword(event.target.value)}
                  placeholder="Enter host password"
                />
              </label>
              <div className="row-actions">
                <button type="button" className="ghost-button" onClick={() => setMode("landing")}>
                  Back
                </button>
                <button type="button" className="primary-button" onClick={handleHostAuthorization} disabled={actionBusy}>
                  Continue
                </button>
              </div>
            </div>
          )}

          {mode === "hostSetup" && (
            <div className="stack">
              <label className="field">
                <span>Host username</span>
                <input
                  value={hostUsername}
                  onChange={(event) => setHostUsername(event.target.value)}
                  maxLength={20}
                  placeholder="Your display name"
                />
              </label>
              <label className="field">
                <span>Maximum players</span>
                <input
                  type="number"
                  min={2}
                  max={16}
                  value={hostPlayerCount}
                  onChange={(event) => setHostPlayerCount(clamp(Number(event.target.value) || 2, 2, 16))}
                />
              </label>
              <div className="row-actions">
                <button type="button" className="ghost-button" onClick={() => setMode("hostPassword")}>
                  Back
                </button>
                <button type="button" className="primary-button" onClick={handleCreateRoom} disabled={actionBusy}>
                  Create Room
                </button>
              </div>
            </div>
          )}

          {mode === "join" && (
            <div className="stack">
              <label className="field">
                <span>Room code</span>
                <input
                  value={joinRoomCode}
                  onChange={(event) => setJoinRoomCode(event.target.value.toUpperCase().slice(0, 4))}
                  maxLength={4}
                  placeholder="ABCD"
                />
              </label>
              <label className="field">
                <span>Username</span>
                <input
                  value={joinUsername}
                  onChange={(event) => setJoinUsername(event.target.value)}
                  maxLength={20}
                  placeholder="Your display name"
                />
              </label>
              <div className="row-actions">
                <button type="button" className="ghost-button" onClick={() => setMode("landing")}>
                  Back
                </button>
                <button type="button" className="primary-button" onClick={handleJoinRoom} disabled={actionBusy}>
                  Join Game
                </button>
              </div>
            </div>
          )}

          {error && <p className="error-banner">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="shell room-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Room {sessionData.room.code}</p>
          <h1>Tier List Game</h1>
        </div>
        <div className="topbar-actions">
          <span className="pill">{formatPhaseLabel(sessionData.room.phase)}</span>
          <button type="button" className="ghost-button" onClick={signOut}>
            Leave session
          </button>
        </div>
      </header>

      <section className="player-strip panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Players</p>
            <h3>
              {sessionData.players.length} / {sessionData.room.maxPlayers} connected to room {sessionData.room.code}
            </h3>
          </div>
          {!sessionData.room.hostConnected && <span className="warning-badge">Host is disconnected. Progress is paused.</span>}
        </div>
        <div className="player-grid">
          {sessionData.players.map((player) => (
            <article key={player.id} className="player-card">
              <div className="player-card-header">
                <strong>{player.username}</strong>
                {player.isHost && <span className="pill accent">Host</span>}
              </div>
              <p>{player.connected ? "Connected" : "Disconnected"}</p>
              <p>Own list: {player.selfSubmitted ? "Submitted" : "Not submitted"}</p>
              <p>
                Peer answers: {player.peerSubmittedCount}/{player.peerTotalCount}
              </p>
            </article>
          ))}
        </div>
      </section>

      {sessionData.view.kind === "lobby" && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Lobby</p>
              <h2>Wait for your players, then launch the round.</h2>
            </div>
            <p className="hint">Share code {sessionData.room.code} with your friends.</p>
          </div>
          {sessionData.room.canStart ? (
            <button
              type="button"
              className="primary-button"
              onClick={() => runRoomAction(() => startGame(session), "game:start")}
              disabled={actionBusy}
            >
              Start Game
            </button>
          ) : (
            <p>At least two players are needed before the host can start.</p>
          )}
        </section>
      )}

      {sessionData.view.kind === "authoring" && (
        <section className="content-grid">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Create your list</p>
                <h2>Write the title, customize tiers, and add the options everyone will rank.</h2>
              </div>
              <p className="hint">
                {sessionData.view.readyCount}/{sessionData.view.totalCount} players have submitted.
              </p>
            </div>

            {sessionData.view.submitted ? (
              <div className="stack">
                <h3>Your list is in.</h3>
                <p>You are locked in for now. We'll move to peer answers when every player has submitted their own list.</p>
              </div>
            ) : (
              <div className="stack">
                <label className="field">
                  <span>Tier list title</span>
                  <input
                    value={authoringDraft.title}
                    onChange={(event) => updateAuthoringDraft((draft) => ({ ...draft, title: event.target.value }))}
                    maxLength={80}
                  />
                </label>

                <div className="builder-grid">
                  <div className="subpanel">
                    <div className="subpanel-header">
                      <h3>Tiers</h3>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() =>
                          updateAuthoringDraft((draft) => ({
                            ...draft,
                            tiers: draft.tiers.length >= 10 ? draft.tiers : [...draft.tiers, `Tier ${draft.tiers.length + 1}`]
                          }))
                        }
                        disabled={authoringDraft.tiers.length >= 10}
                      >
                        Add tier
                      </button>
                    </div>
                    {authoringDraft.tiers.map((tier, index) => (
                      <div className="inline-editor" key={`tier-${index}`}>
                        <input
                          value={tier}
                          maxLength={64}
                          onChange={(event) =>
                            updateAuthoringDraft((draft) => ({
                              ...draft,
                              tiers: draft.tiers.map((entry, tierIndex) => (tierIndex === index ? event.target.value : entry))
                            }))
                          }
                        />
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() =>
                            updateAuthoringDraft((draft) => {
                              if (draft.tiers.length <= 2) {
                                return draft;
                              }
                              const tiers = draft.tiers.filter((_, tierIndex) => tierIndex !== index);
                              const placements = draft.placements.map((placement) => {
                                if (placement === null) {
                                  return null;
                                }
                                if (placement === index) {
                                  return null;
                                }
                                return placement > index ? placement - 1 : placement;
                              });
                              return { ...draft, tiers, placements };
                            })
                          }
                          disabled={authoringDraft.tiers.length <= 2}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="subpanel">
                    <div className="subpanel-header">
                      <h3>Options</h3>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() =>
                          updateAuthoringDraft((draft) => ({
                            ...draft,
                            options: [...draft.options, ""],
                            placements: [...draft.placements, null]
                          }))
                        }
                        disabled={authoringDraft.options.length >= 100}
                      >
                        Add option
                      </button>
                    </div>
                    {authoringDraft.options.map((option, index) => (
                      <div className="inline-editor" key={`option-${index}`}>
                        <textarea
                          value={option}
                          maxLength={120}
                          rows={2}
                          onChange={(event) =>
                            updateAuthoringDraft((draft) => ({
                              ...draft,
                              options: draft.options.map((entry, optionIndex) => (optionIndex === index ? event.target.value : entry))
                            }))
                          }
                        />
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() =>
                            updateAuthoringDraft((draft) => ({
                              ...draft,
                              options: draft.options.filter((_, optionIndex) => optionIndex !== index),
                              placements: draft.placements.filter((_, placementIndex) => placementIndex !== index)
                            }))
                          }
                          disabled={authoringDraft.options.length <= authoringDraft.tiers.length}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <TierBoardEditor
                  title={authoringDraft.title || "Untitled tier list"}
                  tiers={authoringDraft.tiers}
                  options={authoringDraft.options}
                  placements={authoringDraft.placements}
                  onChange={(placements) => updateAuthoringDraft((draft) => ({ ...draft, placements }))}
                />

                <button
                  type="button"
                  className="primary-button"
                  onClick={() =>
                    runRoomAction(
                      () => submitOwnDraft(session, normalizeDraft(authoringDraft as TierListDraftPayload)),
                      "tierlist:submitted"
                    )
                  }
                  disabled={actionBusy}
                >
                  Submit Tier List
                </button>
              </div>
            )}
          </section>
        </section>
      )}

      {sessionData.view.kind === "peerAnswering" && (
        <section className="content-grid">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Peer answering</p>
                <h2>
                  {sessionData.view.completedCount}/{sessionData.view.totalCount} lists finished
                </h2>
              </div>
              <p className="hint">Every other player's list gets its own score and star rating.</p>
            </div>

            {sessionData.view.waiting || !sessionData.view.currentList || !sessionData.view.answer ? (
              <p>You're caught up. Waiting for everyone else to finish their current submissions.</p>
            ) : (
              <div className="stack">
                <TierBoardEditor
                  title={sessionData.view.currentList.title}
                  eyebrowLabel={`${sessionData.view.currentList.authorUsername}'s tier list`}
                  tiers={sessionData.view.currentList.tiers}
                  options={sessionData.view.currentList.options}
                  placements={peerAnswerDraft.placements}
                  onChange={(placements) => updatePeerAnswerDraft((draft) => ({ ...draft, placements }))}
                />

                <section className="panel mini-panel">
                  <p className="eyebrow">How much did you like this list?</p>
                  <StarList
                    starRating={peerAnswerDraft.starRating}
                    onChange={(value) => updatePeerAnswerDraft((draft) => ({ ...draft, starRating: value }))}
                  />
                </section>

                <button
                  type="button"
                  className="primary-button"
                  onClick={() =>
                    runRoomAction(
                      () => submitPeerAnswer(session, currentPeerList!.authorId, peerAnswerDraft),
                      "peer:submitted"
                    )
                  }
                  disabled={actionBusy}
                >
                  Submit Answer
                </button>
              </div>
            )}
          </section>
        </section>
      )}

      {sessionData.view.kind === "review" && (
        <section className="content-grid">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Review and debate</p>
                <h2>
                  Reviewing {sessionData.view.reviewIndex + 1} of {sessionData.view.totalReviews}: {sessionData.view.currentList.title}
                </h2>
              </div>
              <p className="hint">Everyone can revise their own answer until the host moves on.</p>
            </div>

            <div className="stack">
              <label className="field">
                <span>Visible answer</span>
                <select value={reviewPlayerId} onChange={(event) => setReviewPlayerId(event.target.value)}>
                  {sessionData.view.answerOptions.map((answer) => (
                    <option key={answer.playerId} value={answer.playerId}>
                      {answer.username}
                    </option>
                  ))}
                </select>
              </label>

              {currentReviewAnswer && (
                <TierBoardEditor
                  title={sessionData.view.currentList.title}
                  selectedPlayerName={currentReviewAnswer.username}
                  tiers={sessionData.view.currentList.tiers}
                  options={sessionData.view.currentList.options}
                  placements={
                    reviewPlayerId === sessionData.view.editablePlayerId
                      ? reviewAnswerDraft.placements
                      : currentReviewAnswer.placements
                  }
                  readOnly={reviewPlayerId !== sessionData.view.editablePlayerId}
                  onChange={(placements) => updateReviewAnswerDraft((draft) => ({ ...draft, placements }))}
                />
              )}

              {reviewPlayerId === sessionData.view.editablePlayerId ? (
                <section className="panel mini-panel">
                  <p className="eyebrow">Your final rating</p>
                  {sessionData.view.currentList.authorId === sessionData.currentPlayer.id ? (
                    <p>You wrote this list, so there's no star rating for your own answer.</p>
                  ) : (
                    <StarList
                      starRating={reviewAnswerDraft.starRating}
                      onChange={(value) => updateReviewAnswerDraft((draft) => ({ ...draft, starRating: value }))}
                    />
                  )}
                </section>
              ) : (
                <p className="hint">Switch the dropdown back to your own name any time you want to edit your answer.</p>
              )}

              {sessionData.room.canAdvanceReview && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => runRoomAction(() => advanceReview(session), "review:advanced")}
                  disabled={actionBusy}
                >
                  Next Tier List
                </button>
              )}
            </div>
          </section>
        </section>
      )}

      {sessionData.view.kind === "awards" && (
        <section className="content-grid">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Awards</p>
                <h2>The results are in.</h2>
              </div>
              <p className="hint">Agreement is based on average tier-distance across every final answer.</p>
            </div>

            <div className="award-grid">
              <article className="award-card">
                <h3>Most Liked Tier List</h3>
                {sessionData.view.awards.mostLikedTierList ? (
                  <p>
                    {sessionData.view.awards.mostLikedTierList.authorUsername} - {sessionData.view.awards.mostLikedTierList.title} -{" "}
                    {sessionData.view.awards.mostLikedTierList.averageStars.toFixed(2)} stars
                  </p>
                ) : (
                  <p>No rating data yet.</p>
                )}
              </article>
              <article className="award-card">
                <h3>Most Controversial Tier List</h3>
                {sessionData.view.awards.mostControversialTierList ? (
                  <p>
                    {sessionData.view.awards.mostControversialTierList.authorUsername} -{" "}
                    {sessionData.view.awards.mostControversialTierList.title} -{" "}
                    {scorePercent(sessionData.view.awards.mostControversialTierList.score)}
                  </p>
                ) : (
                  <p>No data available.</p>
                )}
              </article>
              <article className="award-card">
                <h3>Most Agreeable Tier List</h3>
                {sessionData.view.awards.mostAgreeableTierList ? (
                  <p>
                    {sessionData.view.awards.mostAgreeableTierList.authorUsername} -{" "}
                    {sessionData.view.awards.mostAgreeableTierList.title} -{" "}
                    {scorePercent(1 - sessionData.view.awards.mostAgreeableTierList.score)}
                  </p>
                ) : (
                  <p>No data available.</p>
                )}
              </article>
            </div>

            <div className="results-columns">
              <section className="subpanel">
                <h3>Players who agreed the most</h3>
                <ol>
                  {sessionData.view.awards.mostAlignedPairs.map((pair) => (
                    <li key={`${pair.playerAId}-${pair.playerBId}`}>
                      {pair.playerAUsername} + {pair.playerBUsername} - {scorePercent(pair.score)}
                    </li>
                  ))}
                </ol>
              </section>
              <section className="subpanel">
                <h3>Players who disagreed the most</h3>
                <ol>
                  {sessionData.view.awards.mostDifferentPairs.map((pair) => (
                    <li key={`${pair.playerAId}-${pair.playerBId}`}>
                      {pair.playerAUsername} + {pair.playerBUsername} - {scorePercent(pair.score)}
                    </li>
                  ))}
                </ol>
              </section>
            </div>

            {sessionData.currentPlayer.isHost && (
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  if (window.confirm("Start a new round with the currently connected players?")) {
                    void runRoomAction(() => playAgain(session), "round:advanced");
                  }
                }}
                disabled={actionBusy}
              >
                Play Again
              </button>
            )}
          </section>
        </section>
      )}

      {error && <p className="error-banner fixed-error">{error}</p>}
    </main>
  );
}

export function App() {
  return <AppContent />;
}
