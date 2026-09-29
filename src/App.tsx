import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Phone,
  Video,
  Monitor,
  Paperclip,
  Send,
  Lock,
  Search,
  Plus,
  Shield,
  FileText,
  Download,
  Eye,
  Reply,
  X,
  PanelRight,
  Bell,
  BellOff,
  BellRing,
  Check,
  CheckCheck,
  Smile,
  Bot,
  Users,
  KeyRound,
  SlidersHorizontal,
  Radio,
  MessageSquarePlus,
  Mic,
  Square,
  Trash2,
  Settings,
} from 'lucide-react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut,
  User as FirebaseUser,
} from 'firebase/auth';
import { auth, googleAuthProvider } from './lib/firebase.ts';
import {
  BotApp,
  CallState,
  ChatRoom,
  ChatType,
  DeviceSession,
  FileAttachment,
  Message,
  UserProfile,
} from './types';
import {
  decryptMessagePayload,
  encryptMessagePayload,
  formatFingerprint,
  sha256Hex,
} from './utils/crypto';
import {
  BrowserNotificationStatus,
  getBrowserNotificationPermission,
  playNotificationSound,
  requestBrowserNotificationPermission,
  triggerBrowserNotification,
} from './utils/notifications';
import { Avatar } from './components/Avatar';
import { CallStageModal } from './components/CallStageModal';
import { BotApiDrawer } from './components/BotApiDrawer';
import { ProfileSyncModal } from './components/ProfileSyncModal';
import { CreateRoomModal } from './components/CreateRoomModal';
import { RightInspectorPanel } from './components/RightInspectorPanel';
import { VoiceMessagePlayer } from './components/VoiceMessagePlayer';

interface InAppToast {
  id: string;
  chatId: string;
  senderName: string;
  chatTitle: string;
  text: string;
  avatarUrl?: string;
}

const QUICK_EMOJIS = ['👍', '❤️', '🔥', '😂', '🎉', '🚀', '👀', '🔒'];
const REAL_SESSION_STORAGE_KEY = 'clickchat_real_account_session_v1';

interface DirectAccountSession {
  uid: string;
  email: string;
  displayName: string;
  token: string;
}

export default function App() {
  // Real Authentication State (Firebase Google Auth OR Direct ClickChat Email/Password JWT)
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [directAccount, setDirectAccount] = useState<DirectAccountSession | null>(() => {
    try {
      const saved = localStorage.getItem(REAL_SESSION_STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [authToken, setAuthToken] = useState<string>('');
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Email/Password Auth Form State
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [submittingAuth, setSubmittingAuth] = useState(false);

  // Synchronized Real Database State
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [devices, setDevices] = useState<DeviceSession[]>([]);
  const [chats, setChats] = useState<ChatRoom[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [bots, setBots] = useState<BotApp[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>('');

  // Navigation & Filters
  const [categoryFilter, setCategoryFilter] = useState<'all' | ChatType>('all');
  const [activeChatId, setActiveChatId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [messageSearch, setMessageSearch] = useState<string>('');
  const [showMessageSearch, setShowMessageSearch] = useState(false);

  // Unread Counters & Push Notifications State
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [notificationPermission, setNotificationPermission] =
    useState<BrowserNotificationStatus>(() => getBrowserNotificationPermission());
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(true);
  const [activeToasts, setActiveToasts] = useState<InAppToast[]>([]);
  const [permissionBannerDismissed, setPermissionBannerDismissed] =
    useState<boolean>(false);

  // Composer State
  const [draftText, setDraftText] = useState('');
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  const [pendingAttachment, setPendingAttachment] =
    useState<FileAttachment | null>(null);
  const [showCiphertextMode, setShowCiphertextMode] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // Voice Message Recording State (MediaRecorder API)
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [liveWaveform, setLiveWaveform] = useState<number[]>(() =>
    Array.from({ length: 24 }, () => 0.25)
  );
  const [voiceError, setVoiceError] = useState<string | null>(null);

  // Modals & Drawers
  const [showBotDrawer, setShowBotDrawer] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [createRoomType, setCreateRoomType] = useState<ChatType | null>(null);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [inspectedMessage, setInspectedMessage] = useState<Message | null>(
    null
  );

  // WebRTC Call State
  const [callState, setCallState] = useState<CallState | null>(null);
  const [incomingCallSignal, setIncomingCallSignal] = useState<any | null>(
    null
  );
  const [incomingSignalsQueue, setIncomingSignalsQueue] = useState<any[]>([]);

  // Decrypted cache for messages verified via Web Crypto API
  const [decryptedMap, setDecryptedMap] = useState<Record<string, string>>({});

  const wsRef = useRef<WebSocket | null>(null);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // MediaRecorder Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<any>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const discardRecordingRef = useRef<boolean>(false);
  const recordedWaveformHistoryRef = useRef<number[]>([]);
  const recordingStartTimeRef = useRef<number>(0);

  const currentUserIdRef = useRef<string>(currentUserId);
  const activeChatIdRef = useRef<string>(activeChatId);
  const chatsRef = useRef<ChatRoom[]>(chats);
  const notificationsEnabledRef = useRef<boolean>(notificationsEnabled);
  const processedSignalIdsRef = useRef<Set<string>>(new Set());
  const notifiedMessageIdsRef = useRef<Set<string>>(new Set());
  const initialMessagesLoadedRef = useRef<boolean>(false);

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
    if (!activeChatId) return;
    setUnreadCounts((prev) => {
      if (!prev[activeChatId]) return prev;
      const next = { ...prev };
      delete next[activeChatId];
      return next;
    });
  }, [activeChatId]);

  useEffect(() => {
    chatsRef.current = chats;
    const userChats = chats.filter(
      (c) =>
        c.memberIds?.includes(currentUserId) ||
        c.adminIds?.includes(currentUserId)
    );
    if (!activeChatId && userChats.length > 0) {
      setActiveChatId(userChats[0].id);
    }
  }, [chats, activeChatId, currentUserId]);

  useEffect(() => {
    notificationsEnabledRef.current = notificationsEnabled;
  }, [notificationsEnabled]);

  // Request Browser Notification Permission during user session
  const handleRequestNotificationPermission = useCallback(async () => {
    const status = await requestBrowserNotificationPermission();
    setNotificationPermission(status);
    setNotificationsEnabled(true);

    if (status === 'granted') {
      triggerBrowserNotification({
        title: 'ClickChat · Уведомления включены',
        body: 'Вы будете получать push-уведомления о новых сообщениях.',
        tag: 'clickchat-welcome-notification',
      });
    }
    return status;
  }, []);

  // Dispatch Push Notification + Sound + In-App Toast for real incoming messages
  const notifyIncomingMessage = useCallback((msg: Message) => {
    if (!notificationsEnabledRef.current) return;

    const targetChat = chatsRef.current.find((c) => c.id === msg.chatId);
    const chatTitle = targetChat?.title || msg.senderName;
    const notificationTitle =
      targetChat && targetChat.type !== 'direct'
        ? `${msg.senderName} в «${chatTitle}»`
        : msg.senderName;
    const bodyText = msg.attachment
      ? msg.attachment.isVoiceMessage ||
        msg.attachment.mimeType?.startsWith('audio/')
        ? '🎤 Голосовое сообщение'
        : `📎 ${msg.attachment.name}`
      : msg.text;

    playNotificationSound();

    triggerBrowserNotification({
      title: notificationTitle,
      body: bodyText,
      icon: targetChat?.avatarUrl || undefined,
      tag: `clickchat-msg-${msg.id}`,
      onClick: () => {
        setActiveChatId(msg.chatId);
      },
    });

    const isDifferentChat = msg.chatId !== activeChatIdRef.current;
    if (isDifferentChat || document.hidden) {
      setUnreadCounts((prev) => ({
        ...prev,
        [msg.chatId]: (prev[msg.chatId] || 0) + 1,
      }));
    }

    const toastId = `toast_${msg.id}`;
    setActiveToasts((prev) => [
      {
        id: toastId,
        chatId: msg.chatId,
        senderName: msg.senderName,
        chatTitle,
        text: bodyText,
        avatarUrl: targetChat?.avatarUrl,
      },
      ...prev.slice(0, 2),
    ]);

    setTimeout(() => {
      setActiveToasts((prev) => prev.filter((t) => t.id !== toastId));
    }, 4500);
  }, []);

  const applyServerState = useCallback(
    (data: any, notifyNew?: boolean) => {
      if (!data) return;
      if (Array.isArray(data.users)) setUsers(data.users);
      if (Array.isArray(data.devices)) setDevices(data.devices);
      if (Array.isArray(data.chats)) setChats(data.chats);
      if (Array.isArray(data.messages)) {
        if (!initialMessagesLoadedRef.current) {
          data.messages.forEach((m: Message) => {
            notifiedMessageIdsRef.current.add(m.id);
          });
          initialMessagesLoadedRef.current = true;
        } else if (notifyNew) {
          data.messages.forEach((m: Message) => {
            if (!notifiedMessageIdsRef.current.has(m.id)) {
              notifiedMessageIdsRef.current.add(m.id);
              if (m.senderId && m.senderId !== currentUserIdRef.current) {
                const targetChat = (data.chats || chatsRef.current).find(
                  (c: ChatRoom) => c.id === m.chatId
                );
                const isMember =
                  targetChat &&
                  (targetChat.memberIds?.includes(currentUserIdRef.current) ||
                    targetChat.adminIds?.includes(currentUserIdRef.current));
                if (isMember) {
                  notifyIncomingMessage(m);
                }
              }
            }
          });
        }
        setMessages(data.messages);
      }
      if (Array.isArray(data.bots)) setBots(data.bots);
    },
    [notifyIncomingMessage]
  );

  // Synchronize authenticated user (Firebase or Direct Email/Password JWT) with PostgreSQL
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user && !directAccount) {
        setAuthToken('');
        setCurrentUserId('');
        setUsers([]);
        setDevices([]);
        setChats([]);
        setMessages([]);
        setBots([]);
        setAuthLoading(false);
        return;
      }

      try {
        setAuthError(null);
        const token = user ? await user.getIdToken() : directAccount!.token;
        const resolvedUid = user ? user.uid : directAccount!.uid;
        const resolvedName = user
          ? user.displayName || undefined
          : directAccount!.displayName;

        setAuthToken(token);
        setCurrentUserId(resolvedUid);

        const res = await fetch('/api/auth/session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            displayName: resolvedName,
            deviceAgent: `ClickChat Web · ${navigator.platform || 'Browser'}`,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          applyServerState(data.state);
          if (data.currentUser?.id) {
            setCurrentUserId(data.currentUser.id);
          }
        }
      } catch (err: any) {
        console.error('Session sync error:', err);
      } finally {
        setAuthLoading(false);
      }
    });

    return () => unsubscribe();
  }, [applyServerState, directAccount]);

  const isAuthenticated = Boolean(firebaseUser || directAccount);

  // Request notification permissions during user session
  useEffect(() => {
    if (!isAuthenticated) return;
    const currentStatus = getBrowserNotificationPermission();
    setNotificationPermission(currentStatus);

    if (currentStatus === 'default') {
      requestBrowserNotificationPermission().then((res) => {
        setNotificationPermission(res);
      });

      const onFirstSessionClick = () => {
        if (getBrowserNotificationPermission() === 'default') {
          requestBrowserNotificationPermission().then((res) => {
            setNotificationPermission(res);
          });
        }
      };
      window.addEventListener('click', onFirstSessionClick, { once: true });
      return () => window.removeEventListener('click', onFirstSessionClick);
    }
  }, [isAuthenticated]);

  // Connect WebSocket + BroadcastChannel for real-time sync
  useEffect(() => {
    if (!isAuthenticated || !authToken) return;

    let reconnectTimer: any;
    let isUnmounted = false;

    const handleRealtimeEvent = (event: string, payload: any) => {
      switch (event) {
        case 'state:init':
          applyServerState(payload);
          break;
        case 'message:created': {
          const alreadyNotified = notifiedMessageIdsRef.current.has(payload.id);
          notifiedMessageIdsRef.current.add(payload.id);
          setMessages((prev) => {
            if (prev.some((m) => m.id === payload.id)) return prev;
            return [...prev, payload];
          });
          if (
            !alreadyNotified &&
            payload.senderId &&
            payload.senderId !== currentUserIdRef.current
          ) {
            const targetChat = chatsRef.current.find(
              (c) => c.id === payload.chatId
            );
            const isMember =
              !targetChat ||
              targetChat.memberIds?.includes(currentUserIdRef.current) ||
              targetChat.adminIds?.includes(currentUserIdRef.current);
            if (isMember) {
              notifyIncomingMessage(payload);
            }
          }
          break;
        }
        case 'message:updated':
          setMessages((prev) =>
            prev.map((m) => (m.id === payload.id ? payload : m))
          );
          break;
        case 'message:read': {
          const { chatId, userId } = payload || {};
          if (!chatId || !userId) break;
          setMessages((prev) =>
            prev.map((m) => {
              if (m.chatId !== chatId) return m;
              const currentReadBy = Array.isArray(m.readBy)
                ? m.readBy
                : m.senderId
                ? [m.senderId]
                : [];
              if (currentReadBy.includes(userId)) return m;
              return { ...m, readBy: [...currentReadBy, userId] };
            })
          );
          break;
        }
        case 'chat:created':
          setChats((prev) =>
            prev.some((c) => c.id === payload.id) ? prev : [payload, ...prev]
          );
          break;
        case 'chats:updated':
          if (Array.isArray(payload)) setChats(payload);
          break;
        case 'profile:updated':
          setUsers((prev) =>
            prev.map((u) => (u.id === payload.id ? payload : u))
          );
          break;
        case 'user:created':
          setUsers((prev) =>
            prev.some((u) => u.id === payload.id)
              ? prev.map((u) => (u.id === payload.id ? payload : u))
              : [...prev, payload]
          );
          break;
        case 'device:created':
          setDevices((prev) =>
            prev.some((d) => d.id === payload.id) ? prev : [payload, ...prev]
          );
          break;
        case 'devices:updated':
          if (Array.isArray(payload)) setDevices(payload);
          break;
        case 'bot:created':
          setBots((prev) =>
            prev.some((b) => b.id === payload.id) ? prev : [...prev, payload]
          );
          break;
        case 'bot:updated':
          setBots((prev) =>
            prev.map((b) => (b.id === payload.id ? payload : b))
          );
          break;
        case 'call:signal': {
          if (!payload || payload.senderId === currentUserIdRef.current) break;
          if (payload.signalId) {
            if (processedSignalIdsRef.current.has(payload.signalId)) break;
            processedSignalIdsRef.current.add(payload.signalId);
          }

          const targetChat = chatsRef.current.find(
            (c) => c.id === payload.chatId
          );
          const isMember =
            !targetChat ||
            targetChat.memberIds?.includes(currentUserIdRef.current) ||
            targetChat.adminIds?.includes(currentUserIdRef.current);
          if (!isMember) break;

          if (payload.type === 'call-invite') {
            setIncomingSignalsQueue([]);
            setCallState({
              active: true,
              callId: payload.callId,
              chatId: payload.chatId,
              mode: payload.mode || 'audio',
              initiatorId: payload.senderId,
              initiatorName: payload.senderName || 'Собеседник',
              direction: 'incoming',
              ringingStartedAt: Date.now(),
              status: 'ringing',
              isMuted: false,
              isCameraOn: payload.mode === 'video',
              isScreenSharing: false,
              remotePeerConnected: false,
              encryptionSAS: payload.encryptionSAS || 'CALL',
              minimized: false,
            });
            if (notificationsEnabledRef.current) {
              triggerBrowserNotification({
                title: `Входящий звонок от ${payload.senderName || 'Собеседника'}`,
                body:
                  payload.mode === 'video'
                    ? 'Видеозвонок в ClickChat'
                    : 'Аудиозвонок в ClickChat',
                tag: `clickchat-call-${payload.callId}`,
              });
            }
          } else if (payload.type === 'call-accept') {
            setCallState((prev) =>
              prev && prev.chatId === payload.chatId
                ? {
                    ...prev,
                    status: 'connected',
                    remotePeerConnected: true,
                    startedAt: Date.now(),
                  }
                : prev
            );
            setIncomingCallSignal(payload);
            setIncomingSignalsQueue((prev) => [...prev.slice(-30), payload]);
          } else if (
            payload.type === 'call-reject' ||
            payload.type === 'call-end' ||
            payload.type === 'call-timeout'
          ) {
            setCallState((prev) =>
              prev && prev.chatId === payload.chatId ? null : prev
            );
            setIncomingCallSignal(payload);
            setIncomingSignalsQueue([]);
          } else {
            setIncomingCallSignal(payload);
            setIncomingSignalsQueue((prev) => [...prev.slice(-30), payload]);
          }
          break;
        }
      }
    };

    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('clickchat_sync_channel');
      broadcastChannelRef.current = bc;
      bc.onmessage = (evt) => {
        if (evt.data?.event) {
          handleRealtimeEvent(evt.data.event, evt.data.payload);
        }
      };
    }

    const connectWs = () => {
      if (isUnmounted) return;
      try {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
        wsRef.current = ws;

        ws.onmessage = (evt) => {
          try {
            const { event, payload } = JSON.parse(evt.data);
            handleRealtimeEvent(event, payload);
          } catch {
            // Ignore malformed packet
          }
        };

        ws.onclose = () => {
          if (!isUnmounted) {
            reconnectTimer = setTimeout(connectWs, 4000);
          }
        };
      } catch {
        // Ignore WS connection error on serverless hosts
      }
    };

    connectWs();

    const statePollTimer = setInterval(async () => {
      if (isUnmounted) return;
      try {
        const res = await fetch('/api/state', {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        applyServerState(data, true);
        if (Array.isArray(data.callSignals)) {
          data.callSignals.forEach((sig: any) => {
            handleRealtimeEvent('call:signal', sig);
          });
        }
      } catch {
        // Ignore transient network poll error
      }
    }, 2000);

    return () => {
      isUnmounted = true;
      clearTimeout(reconnectTimer);
      clearInterval(statePollTimer);
      wsRef.current?.close();
      broadcastChannelRef.current?.close();
    };
  }, [isAuthenticated, authToken, applyServerState, notifyIncomingMessage]);

  const emitWs = (event: string, payload: any) => {
    broadcastChannelRef.current?.postMessage({ event, payload });
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ event, payload, token: authToken }));
    }
  };

  const sendCallSignal = (payload: any) => {
    const sig = {
      ...payload,
      signalId:
        payload?.signalId ||
        `sig_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
    };
    processedSignalIdsRef.current.add(sig.signalId);
    emitWs('call:signal', sig);
    if (authToken) {
      fetch('/api/calls/signal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(sig),
      }).catch(() => {});
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
      if (getBrowserNotificationPermission() === 'default') {
        requestBrowserNotificationPermission().then((res) =>
          setNotificationPermission(res)
        );
      }
    } catch (error: any) {
      const code = String(error?.code || '');
      if (code.includes('unauthorized-domain')) {
        setAuthError(
          'На домене webclickchat.vercel.app вход и регистрация работают напрямую через форму Email и пароль ниже (без ограничений Firebase Console).'
        );
      } else {
        setAuthError(
          error?.message ||
            'Не удалось выполнить вход через Google. Вы можете войти по Email и паролю ниже.'
        );
      }
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput.trim() || !passwordInput) return;
    setAuthError(null);
    setSubmittingAuth(true);
    try {
      // First try the user's own Firebase project (clickchatweb)
      try {
        if (authMode === 'register') {
          const cred = await createUserWithEmailAndPassword(
            auth,
            emailInput.trim(),
            passwordInput
          );
          if (nameInput.trim()) {
            await updateProfile(cred.user, { displayName: nameInput.trim() });
          }
        } else {
          await signInWithEmailAndPassword(
            auth,
            emailInput.trim(),
            passwordInput
          );
        }
        if (getBrowserNotificationPermission() === 'default') {
          requestBrowserNotificationPermission().then((status) =>
            setNotificationPermission(status)
          );
        }
        return;
      } catch (fbErr: any) {
        const fbCode = String(fbErr?.code || '');
        if (
          fbCode.includes('wrong-password') ||
          fbCode.includes('invalid-credential') ||
          fbCode.includes('email-already-in-use') ||
          fbCode.includes('weak-password')
        ) {
          throw fbErr;
        }
        // If domain or provider isn't enabled yet in Firebase Console, fall through to direct ClickChat server auth
      }

      const res = await fetch('/api/auth/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: authMode,
          email: emailInput.trim(),
          password: passwordInput,
          displayName: nameInput.trim() || undefined,
          deviceAgent: `ClickChat Web · ${navigator.platform || 'Browser'}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Ошибка авторизации аккаунта');
        return;
      }

      const session: DirectAccountSession = {
        uid: data.currentUser.id,
        email: data.currentUser.email || emailInput.trim().toLowerCase(),
        displayName: data.currentUser.displayName,
        token: data.token,
      };
      localStorage.setItem(REAL_SESSION_STORAGE_KEY, JSON.stringify(session));
      setDirectAccount(session);
      setAuthToken(data.token);
      setCurrentUserId(data.currentUser.id);
      applyServerState(data.state);

      if (getBrowserNotificationPermission() === 'default') {
        requestBrowserNotificationPermission().then((status) =>
          setNotificationPermission(status)
        );
      }
    } catch (error: any) {
      setAuthError(
        error?.message || 'Не удалось выполнить вход. Проверьте Email и пароль.'
      );
    } finally {
      setSubmittingAuth(false);
    }
  };

  const handleSignOut = async () => {
    setShowProfileModal(false);
    localStorage.removeItem(REAL_SESSION_STORAGE_KEY);
    setDirectAccount(null);
    setAuthToken('');
    setCurrentUserId('');
    if (firebaseUser) {
      await signOut(auth);
    }
  };

  const handleToggleNotifications = async () => {
    if (!notificationsEnabled) {
      if (notificationPermission === 'default') {
        await handleRequestNotificationPermission();
      }
      setNotificationsEnabled(true);
    } else {
      setNotificationsEnabled(false);
    }
  };

  const currentUser: UserProfile = useMemo(() => {
    const activeEmail = firebaseUser?.email || directAccount?.email || '';
    const activeName =
      firebaseUser?.displayName ||
      directAccount?.displayName ||
      activeEmail.split('@')[0] ||
      'Пользователь';
    return (
      users.find((u) => u.id === currentUserId) || {
        id: currentUserId || firebaseUser?.uid || directAccount?.uid || '',
        handle: activeEmail.split('@')[0]?.toLowerCase() || 'user',
        displayName: activeName,
        bio: '',
        avatarUrl: firebaseUser?.photoURL || '',
        publicKeyFingerprint: 'ECDH-P256 · SHA-256',
        publicKeyHex: '',
        status: 'online',
        createdAt: new Date().toISOString(),
        syncCode: '',
      }
    );
  }, [users, currentUserId, firebaseUser, directAccount]);

  const myChats = useMemo(() => {
    if (!currentUser.id) return [];
    return chats.filter(
      (c) =>
        c.memberIds?.includes(currentUser.id) ||
        c.adminIds?.includes(currentUser.id)
    );
  }, [chats, currentUser.id]);

  const activeChat: ChatRoom | undefined = useMemo(() => {
    return myChats.find((c) => c.id === activeChatId) || myChats[0];
  }, [myChats, activeChatId]);

  // Decrypt messages in active chat with Web Crypto API
  useEffect(() => {
    if (!activeChat) return;
    const roomMsgs = messages.filter((m) => m.chatId === activeChat.id);
    roomMsgs.forEach(async (m) => {
      if (decryptedMap[m.id] || !m.e2ee) return;
      const { plaintext } = await decryptMessagePayload(
        m.e2ee,
        activeChat.e2eeKeySeed,
        m.text
      );
      setDecryptedMap((prev) => ({ ...prev, [m.id]: plaintext }));
    });
  }, [messages, activeChat]);

  // Mark incoming messages in active chat as read automatically
  useEffect(() => {
    if (!activeChat || !currentUser.id) return;
    const hasUnreadFromOthers = messages.some(
      (m) =>
        m.chatId === activeChat.id &&
        m.senderId !== currentUser.id &&
        !(m.readBy || []).includes(currentUser.id)
    );
    if (!hasUnreadFromOthers) return;

    setMessages((prev) =>
      prev.map((m) => {
        if (m.chatId !== activeChat.id) return m;
        const currentReadBy = Array.isArray(m.readBy)
          ? m.readBy
          : m.senderId
          ? [m.senderId]
          : [];
        if (currentReadBy.includes(currentUser.id)) return m;
        return { ...m, readBy: [...currentReadBy, currentUser.id] };
      })
    );

    emitWs('message:read', {
      chatId: activeChat.id,
      userId: currentUser.id,
    });
    if (authToken) {
      fetch(`/api/chats/${activeChat.id}/read`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
      }).catch(() => {});
    }
  }, [activeChat?.id, messages.length, currentUser.id, authToken]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, activeChatId]);

  const filteredChats = useMemo(() => {
    return myChats.filter((c) => {
      if (categoryFilter !== 'all' && c.type !== categoryFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          c.title.toLowerCase().includes(q) ||
          (c.handle && c.handle.toLowerCase().includes(q)) ||
          c.description.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [myChats, categoryFilter, searchQuery]);

  const searchedUsersToAdd = useMemo(() => {
    const q = searchQuery.trim().toLowerCase().replace(/^@/, '');
    if (q.length < 2) return [];
    return users.filter(
      (u) =>
        u.id !== currentUser.id &&
        (u.handle.toLowerCase() === q ||
          u.handle.toLowerCase().includes(q) ||
          (u.email && u.email.toLowerCase() === q))
    );
  }, [users, currentUser.id, searchQuery]);

  const activeChatMessages = useMemo(() => {
    if (!activeChat) return [];
    return messages.filter((m) => {
      if (m.chatId !== activeChat.id) return false;
      if (messageSearch.trim()) {
        return m.text.toLowerCase().includes(messageSearch.toLowerCase());
      }
      return true;
    });
  }, [messages, activeChat, messageSearch]);

  const handlePersistRoom = async (room: ChatRoom) => {
    setChats((prev) =>
      prev.some((c) => c.id === room.id) ? prev : [room, ...prev]
    );
    setActiveChatId(room.id);
    emitWs('chat:create', room);
    try {
      await fetch('/api/chats', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(room),
      });
    } catch {
      // Handled via WS
    }
  };

  // Start or open a real 1-on-1 direct chat with another registered user
  const handleStartDirectChatWithUser = async (peer: UserProfile) => {
    const existing = chats.find(
      (c) =>
        c.type === 'direct' &&
        c.memberIds.includes(currentUser.id) &&
        c.memberIds.includes(peer.id)
    );
    if (existing) {
      setActiveChatId(existing.id);
      return;
    }

    const seed = `direct-${[currentUser.id, peer.id].sort().join('-')}`;
    const fp = await formatFingerprint(seed);
    const newDirectRoom: ChatRoom = {
      id: `chat_direct_${Date.now()}`,
      type: 'direct',
      title: peer.displayName,
      handle: peer.handle,
      description: `Личный чат с @${peer.handle}`,
      avatarUrl: peer.avatarUrl || '',
      memberIds: [currentUser.id, peer.id],
      adminIds: [currentUser.id, peer.id],
      botIds: [],
      e2eeKeySeed: seed,
      e2eeFingerprint: fp,
      createdAt: new Date().toISOString(),
      subscriberCount: 2,
    };

    await handlePersistRoom(newDirectRoom);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChat) return;
    if (!draftText.trim() && !pendingAttachment) return;

    if (notificationPermission === 'default') {
      requestBrowserNotificationPermission().then((res) =>
        setNotificationPermission(res)
      );
    }

    const textToSend =
      draftText.trim() ||
      (pendingAttachment ? `Файл: ${pendingAttachment.name}` : '');

    const e2eeEnvelope = await encryptMessagePayload(
      textToSend,
      activeChat.e2eeKeySeed,
      currentUser.publicKeyFingerprint
    );

    const newMsg: Message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      chatId: activeChat.id,
      senderId: currentUser.id,
      senderName:
        activeChat.type === 'channel'
          ? activeChat.title
          : currentUser.displayName,
      senderHandle:
        activeChat.type === 'channel'
          ? activeChat.handle || currentUser.handle
          : currentUser.handle,
      text: textToSend,
      createdAt: new Date().toISOString(),
      replyToId: replyToMessage?.id,
      attachment: pendingAttachment || undefined,
      e2ee: e2eeEnvelope,
      views:
        activeChat.type === 'channel' ? activeChat.subscriberCount : undefined,
      reactions: [],
    };

    setMessages((prev) => [...prev, newMsg]);
    setDecryptedMap((prev) => ({ ...prev, [newMsg.id]: textToSend }));
    setDraftText('');
    setReplyToMessage(null);
    setPendingAttachment(null);
    setShowEmojiPicker(false);

    emitWs('message:send', newMsg);
    try {
      await fetch('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(newMsg),
      });
    } catch {
      // Handled via WS
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || '');
      const hash = await sha256Hex(
        `${file.name}:${file.size}:${dataUrl.slice(0, 256)}`
      );
      const ivBytes = crypto.getRandomValues(new Uint8Array(12));
      const ivHex = Array.from(ivBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      setPendingAttachment({
        id: `att_${Date.now()}`,
        name: file.name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        dataUrl,
        encrypted: true,
        ivHex,
        sha256Hex: hash,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const cleanupVoiceRecordingResources = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (recordingStreamRef.current) {
      recordingStreamRef.current.getTracks().forEach((t) => t.stop());
      recordingStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    mediaRecorderRef.current = null;
    setIsRecordingVoice(false);
    setRecordingSeconds(0);
  }, []);

  const startVoiceRecording = async () => {
    if (!activeChat || isRecordingVoice) return;
    setVoiceError(null);

    if (
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setVoiceError('Ваш браузер не поддерживает запись голосовых сообщений.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      audioChunksRef.current = [];
      recordedWaveformHistoryRef.current = [];
      discardRecordingRef.current = false;
      recordingStartTimeRef.current = Date.now();

      const preferredTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
      ];
      const supportedMimeType =
        preferredTypes.find((t) => MediaRecorder.isTypeSupported(t)) || '';

      const recorder = supportedMimeType
        ? new MediaRecorder(stream, { mimeType: supportedMimeType })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;

      // Setup Web Audio API Analyser for live waveform animation
      try {
        const AudioCtx =
          window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const audioCtx = new AudioCtx();
          audioContextRef.current = audioCtx;
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 64;
          source.connect(analyser);
          const dataArray = new Uint8Array(analyser.frequencyBinCount);

          const updateWaveform = () => {
            analyser.getByteFrequencyData(dataArray);
            const bars: number[] = [];
            const count = 24;
            let avgSum = 0;
            for (let i = 0; i < count; i++) {
              const val = dataArray[i % dataArray.length] / 255;
              const normalized = Math.max(0.18, Math.min(1, val * 1.35));
              bars.push(normalized);
              avgSum += normalized;
            }
            setLiveWaveform(bars);
            recordedWaveformHistoryRef.current.push(avgSum / count);
            animationFrameRef.current = requestAnimationFrame(updateWaveform);
          };
          animationFrameRef.current = requestAnimationFrame(updateWaveform);
        }
      } catch {
        // Fallback waveform if AudioContext fails
      }

      recorder.ondataavailable = (evt) => {
        if (evt.data && evt.data.size > 0) {
          audioChunksRef.current.push(evt.data);
        }
      };

      recorder.onstop = async () => {
        const shouldDiscard = discardRecordingRef.current;
        const durationSec = Math.max(
          1,
          Math.round((Date.now() - recordingStartTimeRef.current) / 1000)
        );
        const chunks = [...audioChunksRef.current];
        const mimeType = recorder.mimeType || supportedMimeType || 'audio/webm';

        // Downsample recorded waveform history into 24 bars
        const rawHistory = recordedWaveformHistoryRef.current;
        const finalWaveform: number[] = [];
        for (let i = 0; i < 24; i++) {
          if (rawHistory.length === 0) {
            finalWaveform.push(0.3 + ((i * 7) % 5) * 0.12);
          } else {
            const idx = Math.floor((i / 24) * rawHistory.length);
            finalWaveform.push(
              Math.max(0.2, Math.min(0.98, rawHistory[idx] || 0.35))
            );
          }
        }

        cleanupVoiceRecordingResources();

        if (shouldDiscard || chunks.length === 0 || !activeChat) {
          return;
        }

        const audioBlob = new Blob(chunks, { type: mimeType });
        const reader = new FileReader();
        reader.onload = async () => {
          const dataUrl = String(reader.result || '');
          const hash = await sha256Hex(
            `voice:${audioBlob.size}:${dataUrl.slice(0, 256)}`
          );
          const ivBytes = crypto.getRandomValues(new Uint8Array(12));
          const ivHex = Array.from(ivBytes)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');

          const ext = mimeType.includes('mp4')
            ? 'm4a'
            : mimeType.includes('ogg')
            ? 'ogg'
            : 'webm';
          const voiceAttachment: FileAttachment = {
            id: `voice_${Date.now()}`,
            name: `Голосовое сообщение.${ext}`,
            size: audioBlob.size,
            mimeType,
            dataUrl,
            encrypted: true,
            ivHex,
            sha256Hex: hash,
            isVoiceMessage: true,
            durationSeconds: durationSec,
            waveform: finalWaveform,
          };

          const textLabel = draftText.trim() || 'Голосовое сообщение';
          const e2eeEnvelope = await encryptMessagePayload(
            `${textLabel}:voice:${hash.slice(0, 16)}`,
            activeChat.e2eeKeySeed,
            currentUser.publicKeyFingerprint
          );

          const newMsg: Message = {
            id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            chatId: activeChat.id,
            senderId: currentUser.id,
            senderName:
              activeChat.type === 'channel'
                ? activeChat.title
                : currentUser.displayName,
            senderHandle:
              activeChat.type === 'channel'
                ? activeChat.handle || currentUser.handle
                : currentUser.handle,
            text: textLabel,
            createdAt: new Date().toISOString(),
            replyToId: replyToMessage?.id,
            attachment: voiceAttachment,
            e2ee: e2eeEnvelope,
            views:
              activeChat.type === 'channel'
                ? activeChat.subscriberCount
                : undefined,
            reactions: [],
          };

          setMessages((prev) => [...prev, newMsg]);
          setDecryptedMap((prev) => ({ ...prev, [newMsg.id]: textLabel }));
          setDraftText('');
          setReplyToMessage(null);

          emitWs('message:send', newMsg);
          try {
            await fetch('/api/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authToken}`,
              },
              body: JSON.stringify(newMsg),
            });
          } catch {
            // Handled via WS
          }
        };
        reader.readAsDataURL(audioBlob);
      };

      recorder.start(150);
      setIsRecordingVoice(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      cleanupVoiceRecordingResources();
      setVoiceError(
        'Нет доступа к микрофону. Разрешите использование микрофона в браузере.'
      );
    }
  };

  const cancelVoiceRecording = () => {
    discardRecordingRef.current = true;
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    ) {
      mediaRecorderRef.current.stop();
    } else {
      cleanupVoiceRecordingResources();
    }
  };

  const finishAndSendVoiceRecording = () => {
    discardRecordingRef.current = false;
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    ) {
      mediaRecorderRef.current.stop();
    }
  };

  const formatRecordingTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} МБ`;
  };

  const handleStartCall = async (mode: 'audio' | 'video' | 'screen') => {
    if (!activeChat) return;
    const callId = `call_${Date.now()}`;
    const sasHash = await formatFingerprint(
      `${activeChat.e2eeKeySeed}:${Date.now()}`
    );
    setCallState({
      active: true,
      callId,
      chatId: activeChat.id,
      mode,
      initiatorId: currentUser.id,
      initiatorName: currentUser.displayName,
      direction: 'outgoing',
      ringingStartedAt: Date.now(),
      status: 'ringing',
      isMuted: false,
      isCameraOn: mode === 'video',
      isScreenSharing: mode === 'screen',
      remotePeerConnected: false,
      encryptionSAS: sasHash.slice(0, 14),
    });
    sendCallSignal({
      type: 'call-invite',
      callId,
      chatId: activeChat.id,
      chatTitle: activeChat.title,
      mode,
      senderId: currentUser.id,
      senderName: currentUser.displayName,
      encryptionSAS: sasHash.slice(0, 14),
    });
  };

  const handleRotateRoomKeys = async () => {
    if (!activeChat) return;
    const newSeed = `ratchet-${activeChat.id}-${Date.now()}`;
    const newFp = await formatFingerprint(newSeed);
    setChats((prev) =>
      prev.map((c) =>
        c.id === activeChat.id
          ? { ...c, e2eeKeySeed: newSeed, e2eeFingerprint: newFp }
          : c
      )
    );
    emitWs('chat:rotate-keys', {
      chatId: activeChat.id,
      newSeed,
      newFingerprint: newFp,
      actorName: currentUser.displayName,
    });
  };

  const handleReaction = (messageId: string, emoji: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const reactions = [...(m.reactions || [])];
        const idx = reactions.findIndex((r) => r.emoji === emoji);
        if (idx >= 0) {
          const userIds = reactions[idx].userIds.includes(currentUser.id)
            ? reactions[idx].userIds.filter((id) => id !== currentUser.id)
            : [...reactions[idx].userIds, currentUser.id];
          if (userIds.length === 0) {
            reactions.splice(idx, 1);
          } else {
            reactions[idx] = { emoji, userIds };
          }
        } else {
          reactions.push({ emoji, userIds: [currentUser.id] });
        }
        return { ...m, reactions };
      })
    );
    emitWs('message:react', {
      messageId,
      emoji,
      userId: currentUser.id,
    });
  };

  const handleUpdateProfile = async (patch: Partial<UserProfile>) => {
    setUsers((prev) =>
      prev.map((u) => (u.id === currentUser.id ? { ...u, ...patch } : u))
    );
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const updated = await res.json();
        setUsers((prev) =>
          prev.map((u) => (u.id === updated.id ? updated : u))
        );
      }
    } catch {
      emitWs('profile:update', patch);
    }
  };

  const handleLinkDeviceByCode = async (
    syncCode: string,
    deviceName: string
  ): Promise<string | null> => {
    try {
      const res = await fetch('/api/devices/link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          syncCode,
          deviceName,
          platform: 'ClickChat Multi-Device Web Crypto Sync',
        }),
      });
      const data = await res.json();
      if (!res.ok) return data.error || 'Ошибка синхронизации';
      applyServerState(data.state);
      return null;
    } catch {
      return 'Не удалось подключить устройство';
    }
  };

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '12:00';
    }
  };

  // Loading Skeleton State
  if (authLoading) {
    return (
      <div className="h-screen w-screen bg-[#0E1621] text-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md p-6 rounded-2xl bg-[#17212B] border border-slate-800 flex flex-col gap-4 shadow-xl">
          <div className="h-5 w-36 bg-slate-800 rounded animate-pulse" />
          <div className="h-4 w-64 bg-slate-800/70 rounded animate-pulse" />
          <div className="h-10 w-full bg-slate-800 rounded-xl animate-pulse mt-2" />
        </div>
      </div>
    );
  }

  // Real Account Authentication Gate (Zero Demo Accounts)
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen w-screen bg-[#0E1621] text-slate-100 flex flex-col justify-between p-6 md:p-12">
        <header className="flex items-center justify-between max-w-6xl w-full mx-auto">
          <span className="text-lg font-bold tracking-tight text-white">
            ClickChat
          </span>
          <button
            onClick={handleGoogleSignIn}
            className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold transition-colors whitespace-nowrap"
          >
            Войти через Google
          </button>
        </header>

        <main className="max-w-5xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 items-center my-auto py-12">
          <div className="lg:col-span-7 flex flex-col gap-5">
            <div className="text-xs font-medium text-sky-400">
              ClickChat · Веб-мессенджер
            </div>
            <h1
              className="text-3xl sm:text-4xl font-bold text-white tracking-tight leading-tight"
              style={{ textWrap: 'balance' }}
            >
              Личные чаты, голосовые сообщения, группы и каналы
            </h1>
            <p className="text-base text-slate-300 leading-relaxed max-w-2xl">
              Общайтесь с друзьями и коллегами, отправляйте голосовые заметки и файлы, созванивайтесь по аудио и видео, ведите каналы и подключайте ботов.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div className="p-4 rounded-2xl bg-[#17212B] border border-slate-800/90">
                <Mic className="w-4 h-4 text-sky-400 mb-2" />
                <div className="text-xs font-semibold text-white">
                  Голосовые и файлы
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Мгновенная запись голосовых сообщений с микрофона и обмен документами.
                </p>
              </div>
              <div className="p-4 rounded-2xl bg-[#17212B] border border-slate-800/90">
                <Users className="w-4 h-4 text-sky-400 mb-2" />
                <div className="text-xs font-semibold text-white">
                  Звонки, группы и каналы
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Аудио- и видеозвонки, демонстрация экрана и тематические каналы.
                </p>
              </div>
              <div className="p-4 rounded-2xl bg-[#17212B] border border-slate-800/90">
                <Bot className="w-4 h-4 text-sky-400 mb-2" />
                <div className="text-xs font-semibold text-white">
                  Боты и уведомления
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Уведомления о новых сообщениях и удобный API для создания своих ботов.
                </p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="p-7 rounded-2xl bg-[#17212B] border border-slate-800 flex flex-col gap-4 shadow-2xl">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">
                    {authMode === 'login'
                      ? 'Вход в ClickChat'
                      : 'Создание аккаунта'}
                  </h2>
                  <p className="text-xs text-slate-400">
                    Войдите через Google или по Email
                  </p>
                </div>
              </div>

              {authError && (
                <div className="p-3 rounded-xl bg-red-950/60 border border-red-500/40 text-xs text-red-300">
                  {authError}
                </div>
              )}

              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="w-full py-3 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 shadow-lg shadow-sky-500/20"
              >
                <Lock className="w-4 h-4" />
                <span>Войти через Google</span>
              </button>

              <div className="relative flex py-1 items-center">
                <div className="flex-grow border-t border-slate-800"></div>
                <span className="flex-shrink mx-3 text-xs text-slate-500">
                  или по Email и паролю
                </span>
                <div className="flex-grow border-t border-slate-800"></div>
              </div>

              <form onSubmit={handleEmailAuth} className="flex flex-col gap-3">
                {authMode === 'register' && (
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Отображаемое имя
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ваше имя"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E1621] border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="you@example.com"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E1621] border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Пароль
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    placeholder="Минимум 6 символов"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E1621] border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submittingAuth}
                  className="w-full py-2.5 px-4 rounded-xl bg-[#242F3D] hover:bg-slate-700 text-white text-xs font-semibold transition-colors"
                >
                  {authMode === 'login'
                    ? 'Войти по Email'
                    : 'Зарегистрировать аккаунт'}
                </button>
              </form>

              <button
                type="button"
                onClick={() => {
                  setAuthMode(authMode === 'login' ? 'register' : 'login');
                  setAuthError(null);
                }}
                className="text-xs text-sky-400 hover:underline text-center"
              >
                {authMode === 'login'
                  ? 'Нет аккаунта? Зарегистрироваться'
                  : 'Уже есть аккаунт? Войти'}
              </button>
            </div>
          </div>
        </main>

        <footer className="max-w-6xl w-full mx-auto text-xs text-slate-500 flex items-center justify-between">
          <span>ClickChat</span>
          <span>Чаты · Звонки · Каналы · Боты</span>
        </footer>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0E1621] text-slate-100 select-none overflow-hidden relative">
      {/* Floating In-App Push Notification Toast Stack */}
      {activeToasts.length > 0 && (
        <div className="fixed top-16 right-5 z-50 flex flex-col gap-2 w-80 pointer-events-auto">
          {activeToasts.map((toast) => (
            <div
              key={toast.id}
              onClick={() => {
                setActiveChatId(toast.chatId);
                setActiveToasts((prev) =>
                  prev.filter((t) => t.id !== toast.id)
                );
              }}
              className="p-3 rounded-2xl bg-[#17212B]/95 backdrop-blur-md border border-sky-500/40 shadow-2xl flex items-start gap-3 cursor-pointer hover:bg-[#1E2C3A] transition-colors"
            >
              <Avatar
                src={toast.avatarUrl}
                title={toast.chatTitle}
                size="sm"
                status="online"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-white truncate">
                    {toast.senderName}
                  </span>
                  <span className="text-[10px] text-sky-400 font-medium">
                    Сейчас
                  </span>
                </div>
                <p className="text-xs text-slate-300 truncate mt-0.5">
                  {toast.text}
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveToasts((prev) =>
                    prev.filter((t) => t.id !== toast.id)
                  );
                }}
                className="text-slate-400 hover:text-white p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Top Navigation Bar */}
      <header className="h-13 shrink-0 flex items-center justify-between px-4 border-b border-slate-800/80 bg-[#17212B]">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setCategoryFilter('all');
          }}
          className="text-base font-bold tracking-tight text-white flex items-center gap-2"
        >
          <span>ClickChat</span>
        </a>

        <nav className="hidden md:flex items-center gap-5 text-xs font-medium text-slate-400">
          <button
            onClick={() => setCategoryFilter('all')}
            className={`hover:text-white transition-colors whitespace-nowrap ${
              categoryFilter === 'all' ? 'text-sky-400 font-semibold' : ''
            }`}
          >
            Все чаты
          </button>
          <button
            onClick={() => setCategoryFilter('direct')}
            className={`hover:text-white transition-colors whitespace-nowrap ${
              categoryFilter === 'direct' ? 'text-sky-400 font-semibold' : ''
            }`}
          >
            Личные
          </button>
          <button
            onClick={() => setCategoryFilter('group')}
            className={`hover:text-white transition-colors whitespace-nowrap ${
              categoryFilter === 'group' ? 'text-sky-400 font-semibold' : ''
            }`}
          >
            Группы
          </button>
          <button
            onClick={() => setCategoryFilter('channel')}
            className={`hover:text-white transition-colors whitespace-nowrap ${
              categoryFilter === 'channel' ? 'text-sky-400 font-semibold' : ''
            }`}
          >
            Каналы
          </button>
          <button
            onClick={() => setShowBotDrawer(true)}
            className="hover:text-white transition-colors whitespace-nowrap"
          >
            Боты и API
          </button>
        </nav>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setCreateRoomType('channel')}
            className="px-3 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-xs font-semibold text-white transition-colors whitespace-nowrap"
          >
            + Создать
          </button>

          <button
            onClick={() => setShowProfileModal(true)}
            className="px-3 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap truncate max-w-[180px]"
          >
            {currentUser.displayName}
          </button>
        </div>
      </header>

      {/* Browser Push Notification Permission Session Banner */}
      {notificationPermission === 'default' && !permissionBannerDismissed && (
        <div className="bg-sky-500/15 border-b border-sky-500/30 px-4 py-2 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-slate-200">
            <BellRing className="w-4 h-4 text-sky-400 shrink-0" />
            <span>
              Включите браузерные push-уведомления (Notifications API) для получения оповещений о новых сообщениях.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleRequestNotificationPermission}
              className="px-3 py-1 rounded-lg bg-sky-500 hover:bg-sky-400 text-white font-semibold transition-colors"
            >
              Разрешить уведомления
            </button>
            <button
              onClick={() => setPermissionBannerDismissed(true)}
              className="p-1 text-slate-400 hover:text-white"
              title="Скрыть"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Main 3-Column Messenger Layout */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Sidebar: Real Chats & Real Registered Contacts */}
        <aside className="w-80 md:w-88 shrink-0 border-r border-slate-800/80 bg-[#17212B] flex flex-col h-full">
          {/* Search & Folder Tabs */}
          <div className="p-3 border-b border-slate-800/70 flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Поиск чатов и каналов..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-full bg-[#242F3D] text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
              <button
                onClick={() => setCreateRoomType('group')}
                className="p-2 rounded-full bg-[#242F3D] hover:bg-sky-500 text-slate-200 hover:text-white transition-colors shrink-0"
                title="Новый чат, группа или канал"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            {/* Folder Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
              {(['all', 'direct', 'group', 'channel'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setCategoryFilter(tab)}
                  className={`py-1.5 px-3 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                    categoryFilter === tab
                      ? 'bg-sky-500 text-white'
                      : 'text-slate-400 hover:bg-[#242F3D] hover:text-slate-200'
                  }`}
                >
                  {tab === 'all'
                    ? 'Все'
                    : tab === 'direct'
                    ? 'Личные'
                    : tab === 'group'
                    ? 'Группы'
                    : 'Каналы'}
                </button>
              ))}
            </div>
          </div>

          {/* Chat List Items */}
          <div className="flex-1 overflow-y-auto">
            {filteredChats.length === 0 ? (
              <div className="p-6 text-center flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-[#242F3D] flex items-center justify-center text-sky-400">
                  <MessageSquarePlus className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-white">
                    У вас пока нет активных чатов
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Создайте личный диалог, группу или вещательный канал.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2 mt-1">
                  <button
                    onClick={() => setCreateRoomType('direct')}
                    className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold transition-colors"
                  >
                    + Новый чат
                  </button>
                  <button
                    onClick={() => setCreateRoomType('channel')}
                    className="px-3.5 py-2 rounded-xl bg-[#242F3D] hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
                  >
                    + Новый канал
                  </button>
                </div>
              </div>
            ) : (
              filteredChats.map((chat) => {
                const isSelected = activeChat?.id === chat.id;
                const roomMsgs = messages.filter((m) => m.chatId === chat.id);
                const lastMsg = roomMsgs[roomMsgs.length - 1];
                const unread = unreadCounts[chat.id] || 0;
                const isLastOwn = lastMsg?.senderId === currentUser.id;

                return (
                  <button
                    key={chat.id}
                    onClick={() => setActiveChatId(chat.id)}
                    className={`w-full text-left px-3.5 py-2.5 flex items-center gap-3 transition-colors ${
                      isSelected
                        ? 'bg-[#2B5278] text-white'
                        : 'hover:bg-[#202B36]'
                    }`}
                  >
                    <Avatar
                      src={chat.avatarUrl}
                      title={chat.title}
                      type={chat.type}
                      status="online"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-sm font-semibold text-white truncate">
                            {chat.title}
                          </span>
                        </div>
                        {lastMsg && (
                          <span
                            className={`text-[11px] tabular-nums shrink-0 flex items-center gap-1 ${
                              isSelected ? 'text-sky-100' : 'text-slate-400'
                            }`}
                          >
                            {isLastOwn && (
                              <CheckCheck className="w-3.5 h-3.5 text-sky-400" />
                            )}
                            {formatTime(lastMsg.createdAt)}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <p
                          className={`text-xs truncate ${
                            isSelected ? 'text-sky-100' : 'text-slate-400'
                          }`}
                        >
                          {lastMsg ? (
                            <>
                              {chat.type !== 'direct' && (
                                <span
                                  className={
                                    isSelected
                                      ? 'text-white font-medium'
                                      : 'text-slate-300'
                                  }
                                >
                                  {isLastOwn ? 'Вы' : lastMsg.senderName}:{' '}
                                </span>
                              )}
                              {lastMsg.text}
                            </>
                          ) : (
                            chat.description
                          )}
                        </p>

                        {unread > 0 && (
                          <span className="px-1.5 py-0.5 min-w-[20px] rounded-full bg-sky-500 text-white text-[11px] font-bold text-center shrink-0">
                            {unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}

            {searchedUsersToAdd.length > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-800/70">
                <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Найденные по запросу
                </div>
                {searchedUsersToAdd.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => {
                      handleStartDirectChatWithUser(u);
                      setSearchQuery('');
                    }}
                    className="w-full text-left px-3.5 py-2 flex items-center gap-3 hover:bg-[#202B36] transition-colors"
                  >
                    <Avatar
                      src={u.avatarUrl}
                      title={u.displayName}
                      status={u.status}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-white truncate">
                        {u.displayName}
                      </div>
                      <div className="text-[11px] text-sky-400 truncate">
                        @{u.handle}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Bottom User Profile Bar */}
          <div className="p-3 border-t border-slate-800/80 bg-[#131C26] flex items-center justify-between gap-2">
            <button
              onClick={() => setShowProfileModal(true)}
              className="flex items-center gap-2.5 min-w-0 text-left hover:opacity-90"
            >
              <Avatar
                src={currentUser.avatarUrl}
                title={currentUser.displayName}
                status="online"
                size="sm"
              />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-white truncate">
                  {currentUser.displayName}
                </div>
                <div className="text-[11px] text-emerald-400 truncate">
                  @{currentUser.handle} · Синхр. (
                  {Math.max(
                    1,
                    devices.filter((d) => d.userId === currentUser.id).length
                  )}{' '}
                  устр.)
                </div>
              </div>
            </button>

            <button
              onClick={handleToggleNotifications}
              className={`p-2 rounded-full transition-colors ${
                notificationsEnabled
                  ? 'bg-[#242F3D] text-sky-400 hover:bg-slate-700'
                  : 'bg-[#242F3D] text-slate-500 hover:text-slate-300'
              }`}
              title={
                notificationsEnabled
                  ? 'Push-уведомления включены (нажмите для отключения)'
                  : 'Включить браузерные Push-уведомления'
              }
            >
              {notificationsEnabled ? (
                <Bell className="w-4 h-4" />
              ) : (
                <BellOff className="w-4 h-4" />
              )}
            </button>
          </div>
        </aside>

        {/* Center Chat Viewport or Clean Empty Workspace */}
        {activeChat ? (
          <main className="flex-1 flex flex-col min-w-0 bg-[#0E1621] h-full">
            {/* Active Chat Header */}
            <div className="h-14 shrink-0 px-5 border-b border-slate-800/80 bg-[#17212B] flex items-center justify-between gap-4">
              <div
                onClick={() => setShowRightPanel(true)}
                className="flex items-center gap-3 min-w-0 cursor-pointer"
              >
                <Avatar
                  src={activeChat.avatarUrl}
                  title={activeChat.title}
                  type={activeChat.type}
                  status={activeChat.type === 'direct' ? 'online' : undefined}
                  size="sm"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h1 className="text-sm font-semibold text-white truncate">
                      {activeChat.title}
                    </h1>
                  </div>
                  <div className="text-xs text-slate-400 truncate">
                    {activeChat.type === 'channel'
                      ? `${activeChat.subscriberCount} подписчиков`
                      : activeChat.type === 'group'
                      ? `${activeChat.memberIds.length} участников`
                      : 'в сети'}
                  </div>
                </div>
              </div>

              {/* Header Action Icons */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => handleStartCall('audio')}
                  className="p-2 rounded-full hover:bg-[#242F3D] text-slate-300 hover:text-white transition-colors"
                  title="Аудио-звонок"
                >
                  <Phone className="w-4 h-4" />
                </button>

                <button
                  onClick={() => handleStartCall('video')}
                  className="p-2 rounded-full hover:bg-[#242F3D] text-slate-300 hover:text-white transition-colors"
                  title="Видео-звонок"
                >
                  <Video className="w-4 h-4" />
                </button>

                <button
                  onClick={() => handleStartCall('screen')}
                  className="p-2 rounded-full hover:bg-[#242F3D] text-slate-300 hover:text-white transition-colors"
                  title="Демонстрация экрана"
                >
                  <Monitor className="w-4 h-4" />
                </button>

                <button
                  onClick={() => setShowMessageSearch(!showMessageSearch)}
                  className="p-2 rounded-full hover:bg-[#242F3D] text-slate-300 hover:text-white transition-colors"
                  title="Поиск сообщений"
                >
                  <Search className="w-4 h-4" />
                </button>

                <button
                  onClick={() => setShowCiphertextMode(!showCiphertextMode)}
                  className={`p-2 rounded-full transition-colors ${
                    showCiphertextMode
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'hover:bg-[#242F3D] text-slate-400 hover:text-white'
                  }`}
                  title="Показать/скрыть крипто-пакеты AES-256-GCM"
                >
                  <SlidersHorizontal className="w-4 h-4" />
                </button>

                <button
                  onClick={() => setShowRightPanel(!showRightPanel)}
                  className={`p-2 rounded-full transition-colors ${
                    showRightPanel
                      ? 'bg-[#242F3D] text-sky-400'
                      : 'hover:bg-[#242F3D] text-slate-400 hover:text-white'
                  }`}
                  title="Информация о чате"
                >
                  <PanelRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* In-Chat Search Bar */}
            {showMessageSearch && (
              <div className="px-5 py-2 bg-[#17212B] border-b border-slate-800 flex items-center gap-2">
                <Search className="w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Поиск в этом чате..."
                  value={messageSearch}
                  onChange={(e) => setMessageSearch(e.target.value)}
                  className="flex-1 bg-transparent text-xs text-white focus:outline-none"
                />
                <button
                  onClick={() => {
                    setMessageSearch('');
                    setShowMessageSearch(false);
                  }}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Закрыть
                </button>
              </div>
            )}

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-5 space-y-2.5 select-text">
              {activeChatMessages.length === 0 && (
                <div className="text-center py-12 text-xs text-slate-400">
                  Сообщений пока нет. Напишите сообщение или запишите голосовое ниже.
                </div>
              )}

              {activeChatMessages.map((msg) => {
                const isOwn = msg.senderId === currentUser.id;
                const repliedMsg = msg.replyToId
                  ? messages.find((m) => m.id === msg.replyToId)
                  : null;
                const displayText = decryptedMap[msg.id] || msg.text;
                const showSenderHeader =
                  !isOwn && activeChat.type !== 'direct';

                return (
                  <div
                    key={msg.id}
                    className={`flex items-end gap-2 ${
                      activeChat.type === 'channel'
                        ? 'justify-center'
                        : isOwn
                        ? 'justify-end'
                        : 'justify-start'
                    }`}
                  >
                    {!isOwn && activeChat.type === 'group' && (
                      <Avatar
                        title={msg.senderName}
                        type={msg.isBot ? 'bot' : 'direct'}
                        size="sm"
                      />
                    )}

                    <div
                      className={`group relative px-3.5 py-2 shadow-sm transition-colors ${
                        activeChat.type === 'channel'
                          ? 'w-full max-w-2xl rounded-2xl bg-[#182533] text-white'
                          : isOwn
                          ? 'max-w-md sm:max-w-lg rounded-2xl rounded-br-sm bg-[#2B5278] text-white'
                          : 'max-w-md sm:max-w-lg rounded-2xl rounded-bl-sm bg-[#182533] text-white'
                      }`}
                    >
                      {(showSenderHeader || msg.isBot) && (
                        <div className="flex items-center justify-between gap-3 mb-0.5">
                          <span className="text-xs font-semibold text-sky-400">
                            {msg.senderName}
                            {msg.isBot && (
                              <span className="ml-1.5 text-[10px] font-normal text-sky-300/80">
                                бот
                              </span>
                            )}
                          </span>
                        </div>
                      )}

                      {repliedMsg && (
                        <div className="mb-1.5 pl-2.5 py-1 rounded bg-black/20 border-l-2 border-sky-400 text-xs">
                          <div className="font-semibold text-sky-300 truncate">
                            {repliedMsg.senderName}
                          </div>
                          <div className="text-slate-300 truncate">
                            {repliedMsg.text}
                          </div>
                        </div>
                      )}

                      {showCiphertextMode ? (
                        <div className="p-2 rounded-lg bg-black/30 font-mono text-[11px] text-emerald-300 break-all space-y-0.5">
                          <div>ALG: {msg.e2ee.algorithm}</div>
                          <div>IV: {msg.e2ee.ivHex}</div>
                          <div>CIPHER: {msg.e2ee.ciphertextBase64}</div>
                        </div>
                      ) : (
                        !(
                          (msg.attachment?.isVoiceMessage ||
                            msg.attachment?.mimeType?.startsWith('audio/')) &&
                          displayText === 'Голосовое сообщение'
                        ) && (
                          <p className="text-[14.5px] leading-snug whitespace-pre-wrap break-words">
                            {displayText}
                          </p>
                        )
                      )}

                      {msg.attachment &&
                        (msg.attachment.isVoiceMessage ||
                        msg.attachment.mimeType?.startsWith('audio/') ? (
                          <VoiceMessagePlayer
                            attachment={msg.attachment}
                            isOwn={isOwn}
                          />
                        ) : (
                          <div className="mt-2 p-2.5 rounded-xl bg-black/20 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-9 h-9 rounded-full bg-sky-500/20 text-sky-300 flex items-center justify-center shrink-0">
                                <FileText className="w-4 h-4" />
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-white truncate">
                                  {msg.attachment.name}
                                </div>
                                <div className="text-[11px] text-slate-300">
                                  {formatFileSize(msg.attachment.size)}
                                </div>
                              </div>
                            </div>
                            <a
                              href={msg.attachment.dataUrl}
                              download={msg.attachment.name}
                              className="p-2 rounded-full bg-sky-500 hover:bg-sky-400 text-white shrink-0"
                              title="Скачать"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        ))}

                      <div className="mt-1 flex items-center justify-end gap-2 text-[11px] text-slate-300/80 select-none">
                        <div className="flex items-center gap-1 mr-auto">
                          {['👍', '❤️', '🔥'].map((emoji) => {
                            const r = (msg.reactions || []).find(
                              (item) => item.emoji === emoji
                            );
                            const count = r?.userIds.length || 0;
                            const reacted = r?.userIds.includes(currentUser.id);
                            if (count === 0) {
                              return (
                                <button
                                  key={emoji}
                                  onClick={() => handleReaction(msg.id, emoji)}
                                  className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-xs"
                                >
                                  {emoji}
                                </button>
                              );
                            }
                            return (
                              <button
                                key={emoji}
                                onClick={() => handleReaction(msg.id, emoji)}
                                className={`px-1.5 py-0.5 rounded-full text-[11px] ${
                                  reacted
                                    ? 'bg-sky-500/30 text-white'
                                    : 'bg-black/25 text-slate-200'
                                }`}
                              >
                                {emoji} {count}
                              </button>
                            );
                          })}
                        </div>

                        <button
                          onClick={() => setReplyToMessage(msg)}
                          className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-white transition-opacity"
                          title="Ответить"
                        >
                          <Reply className="w-3 h-3" />
                        </button>

                        {activeChat.type === 'channel' &&
                          msg.views !== undefined && (
                            <span className="flex items-center gap-1">
                              <Eye className="w-3 h-3" />
                              {msg.views}
                            </span>
                          )}

                        <span className="tabular-nums">
                          {formatTime(msg.createdAt)}
                        </span>

                        {isOwn &&
                          ((msg.readBy || []).some(
                            (uid) => uid !== msg.senderId
                          ) ? (
                            <span
                              title="Прочитано"
                              className="inline-flex items-center"
                            >
                              <CheckCheck className="w-3.5 h-3.5 text-sky-300 shrink-0" />
                            </span>
                          ) : (
                            <span
                              title="Отправлено"
                              className="inline-flex items-center"
                            >
                              <Check className="w-3.5 h-3.5 text-slate-300/80 shrink-0" />
                            </span>
                          ))}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Bottom Message Composer Bar */}
            <div className="px-4 py-3 border-t border-slate-800/80 bg-[#17212B] relative">
              {(replyToMessage || pendingAttachment) && (
                <div className="mb-2 px-3.5 py-2 rounded-xl bg-[#242F3D] flex items-center justify-between text-xs">
                  {replyToMessage ? (
                    <div className="truncate text-slate-200 border-l-2 border-sky-400 pl-2.5">
                      <span className="font-semibold text-sky-400 block">
                        Ответ {replyToMessage.senderName}
                      </span>
                      <span className="text-slate-300 truncate">
                        {replyToMessage.text}
                      </span>
                    </div>
                  ) : (
                    <div className="truncate text-sky-300 font-medium">
                      📎 Прикреплен файл: {pendingAttachment?.name}
                    </div>
                  )}
                  <button
                    onClick={() => {
                      setReplyToMessage(null);
                      setPendingAttachment(null);
                    }}
                    className="p-1 text-slate-400 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {showEmojiPicker && (
                <div className="absolute bottom-16 left-14 z-30 p-2 rounded-2xl bg-[#242F3D] border border-slate-700 shadow-xl flex items-center gap-1.5">
                  {QUICK_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        setDraftText((prev) => prev + emoji);
                        setShowEmojiPicker(false);
                      }}
                      className="w-8 h-8 rounded-lg hover:bg-slate-700 flex items-center justify-center text-lg transition-colors"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}

              {voiceError && (
                <div className="mb-2 px-3.5 py-2 rounded-xl bg-red-950/60 border border-red-500/40 flex items-center justify-between text-xs text-red-200">
                  <span>{voiceError}</span>
                  <button
                    type="button"
                    onClick={() => setVoiceError(null)}
                    className="p-1 text-red-300 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {isRecordingVoice ? (
                <div className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-[#242F3D] border border-red-500/40">
                  <button
                    type="button"
                    onClick={cancelVoiceRecording}
                    className="p-2 rounded-full hover:bg-red-500/20 text-slate-300 hover:text-red-300 transition-colors shrink-0"
                    title="Отменить запись"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-xs font-semibold text-white tabular-nums">
                      {formatRecordingTimer(recordingSeconds)}
                    </span>
                  </div>

                  <div className="flex-1 flex items-center gap-1 h-6 overflow-hidden px-2">
                    {liveWaveform.map((bar, idx) => (
                      <span
                        key={idx}
                        style={{
                          height: `${Math.max(4, Math.round(bar * 22))}px`,
                        }}
                        className="flex-1 min-w-[3px] rounded-full bg-sky-400 transition-all duration-75"
                      />
                    ))}
                  </div>

                  <span className="hidden sm:inline text-xs text-slate-400">
                    Запись голосового...
                  </span>

                  <button
                    type="button"
                    onClick={finishAndSendVoiceRecording}
                    className="w-9 h-9 rounded-full bg-sky-500 hover:bg-sky-400 text-white flex items-center justify-center transition-colors shrink-0 shadow-md shadow-sky-500/20"
                    title="Остановить и отправить голосовое сообщение"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={handleSendMessage}
                  className="flex items-center gap-2"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2.5 rounded-full hover:bg-[#242F3D] text-slate-400 hover:text-white transition-colors shrink-0"
                    title="Прикрепить файл"
                  >
                    <Paperclip className="w-5 h-5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    className="p-2.5 rounded-full hover:bg-[#242F3D] text-slate-400 hover:text-white transition-colors shrink-0"
                    title="Смайлы"
                  >
                    <Smile className="w-5 h-5" />
                  </button>

                  <input
                    type="text"
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    placeholder={
                      activeChat.type === 'channel'
                        ? `Написать публикацию в «${activeChat.title}»...`
                        : 'Сообщение...'
                    }
                    className="flex-1 px-4 py-2.5 rounded-full bg-[#242F3D] text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />

                  <button
                    type="button"
                    onClick={startVoiceRecording}
                    className="w-10 h-10 rounded-full bg-[#242F3D] hover:bg-slate-700 text-slate-200 hover:text-white flex items-center justify-center transition-colors shrink-0"
                    title="Записать голосовое сообщение"
                  >
                    <Mic className="w-4 h-4" />
                  </button>

                  <button
                    type="submit"
                    className="w-10 h-10 rounded-full bg-sky-500 hover:bg-sky-400 text-white flex items-center justify-center transition-colors shrink-0 shadow-md shadow-sky-500/20"
                    title="Отправить"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
              )}
            </div>
          </main>
        ) : (
          <main className="flex-1 flex flex-col items-center justify-center p-8 bg-[#0E1621] text-center">
            <div className="max-w-md flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-[#17212B] border border-slate-800 flex items-center justify-center text-sky-400">
                <MessageSquarePlus className="w-8 h-8" />
              </div>
              <h2 className="text-lg font-bold text-white">
                Выберите чат или создайте новый
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Выберите диалог в списке слева или создайте новый личный чат, группу или канал.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2.5 mt-2">
                <button
                  onClick={() => setCreateRoomType('direct')}
                  className="px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold flex items-center gap-2 transition-colors"
                >
                  <MessageSquarePlus className="w-4 h-4" />
                  <span>Создать личный чат</span>
                </button>
                <button
                  onClick={() => setCreateRoomType('group')}
                  className="px-4 py-2.5 rounded-xl bg-[#17212B] hover:bg-[#242F3D] border border-slate-800 text-slate-200 text-xs font-medium flex items-center gap-2 transition-colors"
                >
                  <Users className="w-4 h-4 text-sky-400" />
                  <span>Создать группу</span>
                </button>
                <button
                  onClick={() => setCreateRoomType('channel')}
                  className="px-4 py-2.5 rounded-xl bg-[#17212B] hover:bg-[#242F3D] border border-slate-800 text-slate-200 text-xs font-medium flex items-center gap-2 transition-colors"
                >
                  <Radio className="w-4 h-4 text-sky-400" />
                  <span>Создать канал</span>
                </button>
              </div>
            </div>
          </main>
        )}

        {/* Right Info & Profile Panel */}
        {activeChat && showRightPanel && (
          <RightInspectorPanel
            chat={activeChat}
            messages={activeChatMessages}
            users={users}
            bots={bots}
            inspectedMessage={inspectedMessage}
            notificationsEnabled={notificationsEnabled}
            onToggleNotifications={handleToggleNotifications}
            onStartCall={handleStartCall}
            onClearInspectedMessage={() => setInspectedMessage(null)}
            onRotateRoomKeys={handleRotateRoomKeys}
            onOpenBotDrawer={() => setShowBotDrawer(true)}
            onClosePanel={() => setShowRightPanel(false)}
          />
        )}
      </div>

      {/* Active WebRTC Audio/Video/Screen-Share Call Stage */}
      {callState && callState.active && (
        <CallStageModal
          call={callState}
          chat={
            chats.find((c) => c.id === callState.chatId) || activeChat
          }
          currentUser={currentUser}
          onEndCall={() => {
            setCallState(null);
            setIncomingSignalsQueue([]);
          }}
          onUpdateCall={(patch) =>
            setCallState((prev) => (prev ? { ...prev, ...patch } : null))
          }
          sendSignal={(payload) => sendCallSignal(payload)}
          incomingSignal={incomingCallSignal}
          incomingSignalsQueue={incomingSignalsQueue}
        />
      )}

      {/* Open Bot API & Webhook Playground Drawer */}
      {showBotDrawer && (
        <BotApiDrawer
          bots={bots}
          chats={chats}
          currentUser={currentUser}
          activeChatId={activeChatId}
          authToken={authToken}
          onClose={() => setShowBotDrawer(false)}
          onBotCreated={(newBot) =>
            setBots((prev) =>
              prev.some((b) => b.id === newBot.id) ? prev : [...prev, newBot]
            )
          }
          onBotUpdated={(updated) =>
            setBots((prev) =>
              prev.map((b) => (b.id === updated.id ? updated : b))
            )
          }
        />
      )}

      {/* Authenticated Account, Cryptographic Keys & Multi-Device Sync Modal */}
      {showProfileModal && (
        <ProfileSyncModal
          currentUser={currentUser}
          userEmail={firebaseUser?.email || directAccount?.email || undefined}
          allUsers={users}
          devices={devices}
          onClose={() => setShowProfileModal(false)}
          onUpdateProfile={handleUpdateProfile}
          onLinkDeviceByCode={handleLinkDeviceByCode}
          onRevokeDevice={(deviceId) => emitWs('device:revoke', { deviceId })}
          onSignOut={handleSignOut}
        />
      )}

      {/* Create Direct Chat, Group Chat or Channel Modal */}
      {createRoomType && (
        <CreateRoomModal
          initialType={createRoomType}
          currentUser={currentUser}
          users={users}
          bots={bots}
          onClose={() => setCreateRoomType(null)}
          onCreateRoom={handlePersistRoom}
        />
      )}
    </div>
  );
}
