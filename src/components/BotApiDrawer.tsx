import React, { useState } from 'react';
import {
  Bot,
  Plus,
  Send,
  Copy,
  Check,
  Terminal,
  X,
  PlusCircle,
  Trash2,
} from 'lucide-react';
import { BotApp, BotCommand, ChatRoom, UserProfile } from '../types';

interface BotApiDrawerProps {
  bots: BotApp[];
  chats: ChatRoom[];
  currentUser: UserProfile;
  activeChatId: string;
  authToken: string;
  onClose: () => void;
  onBotCreated: (bot: BotApp) => void;
  onBotUpdated: (bot: BotApp) => void;
}

export const BotApiDrawer: React.FC<BotApiDrawerProps> = ({
  bots,
  chats,
  currentUser,
  activeChatId,
  authToken,
  onClose,
  onBotCreated,
  onBotUpdated,
}) => {
  const [selectedBotId, setSelectedBotId] = useState<string>(
    bots[0]?.id || ''
  );
  const [creatingNew, setCreatingNew] = useState(false);

  // New bot form state
  const [newName, setNewName] = useState('');
  const [newHandle, setNewHandle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newWebhook, setNewWebhook] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  // Live API Tester state
  const [testChatId, setTestChatId] = useState<string>(
    activeChatId || chats[0]?.id || ''
  );
  const [testMessage, setTestMessage] = useState(
    'Автоматическое уведомление через открытый ClickChat Bot API: все узлы синхронизированы.'
  );
  const [apiResponseJson, setApiResponseJson] = useState<string>('');
  const [isSendingApi, setIsSendingApi] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

  // New command form
  const [cmdTrigger, setCmdTrigger] = useState('');
  const [cmdDesc, setCmdDesc] = useState('');
  const [cmdReply, setCmdReply] = useState('');

  const selectedBot = bots.find((b) => b.id === selectedBotId) || bots[0];

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
  };

  const handleCreateBot = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    if (!newName.trim() || !newHandle.trim()) {
      setCreateError('Заполните имя бота и его @handle');
      return;
    }

    try {
      const res = await fetch('/api/bots', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          name: newName.trim(),
          handle: newHandle.trim(),
          description: newDesc.trim(),
          webhookUrl: newWebhook.trim(),
          ownerId: currentUser.id,
          targetChatId: activeChatId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error || 'Не удалось создать бота');
        return;
      }
      onBotCreated(data);
      setSelectedBotId(data.id);
      setCreatingNew(false);
      setNewName('');
      setNewHandle('');
      setNewDesc('');
      setNewWebhook('');
    } catch {
      setCreateError('Ошибка соединения с сервером ClickChat');
    }
  };

  const handleAddCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBot || !cmdTrigger.trim() || !cmdReply.trim()) return;
    const normalized = cmdTrigger.trim().startsWith('/')
      ? cmdTrigger.trim().toLowerCase()
      : `/${cmdTrigger.trim().toLowerCase()}`;

    const nextCommands: BotCommand[] = [
      ...selectedBot.commands.filter((c) => c.command !== normalized),
      {
        command: normalized,
        description: cmdDesc.trim() || 'Пользовательская команда бота',
        responseTemplate: cmdReply.trim(),
      },
    ];

    const res = await fetch(`/api/bots/${selectedBot.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ commands: nextCommands }),
    });
    if (res.ok) {
      const updated = await res.json();
      onBotUpdated(updated);
      setCmdTrigger('');
      setCmdDesc('');
      setCmdReply('');
    }
  };

  const handleRemoveCommand = async (cmdName: string) => {
    if (!selectedBot) return;
    const nextCommands = selectedBot.commands.filter((c) => c.command !== cmdName);
    const res = await fetch(`/api/bots/${selectedBot.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ commands: nextCommands }),
    });
    if (res.ok) {
      onBotUpdated(await res.json());
    }
  };

  const handleToggleBotInChat = async (chatId: string) => {
    if (!selectedBot) return;
    const res = await fetch(`/api/bots/${selectedBot.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ attachChatId: chatId }),
    });
    if (res.ok) {
      onBotUpdated(await res.json());
    }
  };

  const executeLiveApiSend = async () => {
    if (!selectedBot || !testChatId || !testMessage.trim()) return;
    setIsSendingApi(true);
    try {
      const res = await fetch(`/api/bot/${selectedBot.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: testChatId,
          text: testMessage,
        }),
      });
      const json = await res.json();
      setApiResponseJson(JSON.stringify(json, null, 2));
    } catch (err) {
      setApiResponseJson(JSON.stringify({ ok: false, error: String(err) }, null, 2));
    } finally {
      setIsSendingApi(false);
    }
  };

  const executeGetUpdates = async () => {
    if (!selectedBot) return;
    setIsSendingApi(true);
    try {
      const res = await fetch(`/api/bot/${selectedBot.token}/getUpdates`);
      const json = await res.json();
      setApiResponseJson(JSON.stringify(json, null, 2));
    } catch (err) {
      setApiResponseJson(JSON.stringify({ ok: false, error: String(err) }, null, 2));
    } finally {
      setIsSendingApi(false);
    }
  };

  const copyToken = () => {
    if (!selectedBot) return;
    navigator.clipboard.writeText(selectedBot.token);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 1800);
  };

  const originUrl =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0B0F17] border border-slate-800 rounded-xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#111827]">
          <div className="flex items-center gap-3">
            <Bot className="w-5 h-5 text-emerald-400" />
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Платформа ботов и открытый HTTP API ClickChat
              </h2>
              <p className="text-xs text-slate-400">
                Создавайте ботов, настраивайте команды и отправляйте сообщения через открытые REST эндпоинты
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-800">
          {/* Left Column: Bot List & Creation */}
          <div className="lg:col-span-4 p-5 flex flex-col gap-4 bg-[#0D121C]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400">
                Зарегистрированные боты ({bots.length})
              </span>
              <button
                onClick={() => setCreatingNew(!creatingNew)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Новый бот</span>
              </button>
            </div>

            {creatingNew && (
              <form
                onSubmit={handleCreateBot}
                className="p-4 rounded-lg bg-slate-900/90 border border-slate-800 flex flex-col gap-3"
              >
                <h3 className="text-xs font-semibold text-slate-200">
                  Регистрация нового бота API
                </h3>
                <input
                  type="text"
                  placeholder="Название (напр. Deploy Monitor)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                />
                <input
                  type="text"
                  placeholder="@handle (напр. deploy_bot)"
                  value={newHandle}
                  onChange={(e) => setNewHandle(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                />
                <input
                  type="text"
                  placeholder="Описание функций бота"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                />
                <input
                  type="text"
                  placeholder="Webhook URL (опционально)"
                  value={newWebhook}
                  onChange={(e) => setNewWebhook(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                />
                {createError && (
                  <p className="text-xs text-red-400">{createError}</p>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="submit"
                    className="flex-1 py-2 rounded-lg bg-emerald-500 text-slate-950 text-xs font-semibold hover:bg-emerald-400 transition-colors"
                  >
                    Выпустить API Токен
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreatingNew(false)}
                    className="px-3 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs hover:bg-slate-700"
                  >
                    Отмена
                  </button>
                </div>
              </form>
            )}

            <div className="flex flex-col gap-2">
              {bots.map((bot) => {
                const active = selectedBot?.id === bot.id;
                return (
                  <button
                    key={bot.id}
                    onClick={() => setSelectedBotId(bot.id)}
                    className={`w-full text-left p-3.5 rounded-lg border transition-colors ${
                      active
                        ? 'bg-slate-800/90 border-emerald-500/50 text-slate-100'
                        : 'bg-slate-900/40 border-slate-800/80 text-slate-300 hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{bot.name}</span>
                      <span className="text-xs font-mono text-emerald-400">
                        @{bot.handle}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                      {bot.description}
                    </p>
                    <div className="mt-2 text-[11px] text-slate-400 font-mono tabular-nums">
                      Отправлено пакетов: {bot.messagesSent} · Команд: {bot.commands.length}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Column: Selected Bot Details, Open API Playground & Commands */}
          {selectedBot && (
            <div className="lg:col-span-8 p-6 flex flex-col gap-6">
              {/* Token & Credentials */}
              <div className="flex flex-col gap-2 pb-5 border-b border-slate-800">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-slate-100">
                      {selectedBot.name}
                    </h3>
                    <p className="text-xs text-slate-400 font-mono">
                      @{selectedBot.handle} · ID: {selectedBot.id}
                    </p>
                  </div>
                  <span className="text-xs text-emerald-400 font-mono">
                    Активен · E2EE Ready
                  </span>
                </div>

                <div className="mt-2">
                  <label className="block text-xs text-slate-400 mb-1">
                    Секретный HTTP API Токен (для заголовков и URL `/api/bot/:token/...`):
                  </label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-emerald-300 select-all overflow-x-auto">
                      {selectedBot.token}
                    </code>
                    <button
                      onClick={copyToken}
                      className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1.5 whitespace-nowrap"
                    >
                      {copiedToken ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Скопировано</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Копировать</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Live Open API Tester */}
              <div className="flex flex-col gap-3 pb-5 border-b border-slate-800">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-emerald-400" />
                    <span>Живая консоль Open Bot API (реальный HTTP запрос)</span>
                  </h4>
                  <button
                    onClick={executeGetUpdates}
                    disabled={isSendingApi}
                    className="text-xs font-mono text-emerald-400 hover:underline"
                  >
                    GET /getUpdates
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Целевой чат / канал (`chatId`):
                    </label>
                    <select
                      value={testChatId}
                      onChange={(e) => setTestChatId(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                    >
                      {chats.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title} ({c.type})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs text-slate-400 mb-1">
                      Текст сообщения (`text`):
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={testMessage}
                        onChange={(e) => setTestMessage(e.target.value)}
                        className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                      />
                      <button
                        onClick={executeLiveApiSend}
                        disabled={isSendingApi}
                        className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>POST /sendMessage</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* cURL Example */}
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/90 text-[11px] font-mono text-slate-300 overflow-x-auto">
                  <div className="text-slate-500 mb-1">
                    Пример вызова из внешнего скрипта или терминала:
                  </div>
                  <code>
                    curl -X POST {originUrl}/api/bot/{selectedBot.token}/sendMessage -H "Content-Type: application/json" -d '{JSON.stringify({ chatId: testChatId, text: testMessage })}'
                  </code>
                </div>

                {apiResponseJson && (
                  <pre className="p-3 rounded-lg bg-slate-950 border border-emerald-500/30 text-[11px] font-mono text-emerald-300 max-h-36 overflow-y-auto">
                    {apiResponseJson}
                  </pre>
                )}
              </div>

              {/* Bot Slash Commands Configuration */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="text-sm font-semibold text-slate-200 mb-2">
                    Команды бота в чатах
                  </h4>
                  <div className="flex flex-col gap-2 mb-3">
                    {selectedBot.commands.map((c) => (
                      <div
                        key={c.command}
                        className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 flex items-start justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-mono font-semibold text-emerald-400">
                            {c.command}
                          </div>
                          <div className="text-xs text-slate-400">{c.description}</div>
                          <div className="text-xs text-slate-200 mt-1 break-words">
                            Ответ: «{c.responseTemplate}»
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveCommand(c.command)}
                          className="p-1 text-slate-500 hover:text-red-400"
                          title="Удалить команду"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <form
                    onSubmit={handleAddCommand}
                    className="flex flex-col gap-2 p-3 rounded-lg bg-slate-900/40 border border-slate-800"
                  >
                    <span className="text-xs font-medium text-slate-300">
                      Добавить реакцию на команду
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="/price"
                        value={cmdTrigger}
                        onChange={(e) => setCmdTrigger(e.target.value)}
                        className="px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100"
                      />
                      <input
                        type="text"
                        placeholder="Описание команды"
                        value={cmdDesc}
                        onChange={(e) => setCmdDesc(e.target.value)}
                        className="px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs text-slate-100"
                      />
                    </div>
                    <input
                      type="text"
                      placeholder="Текст автоматического ответа бота..."
                      value={cmdReply}
                      onChange={(e) => setCmdReply(e.target.value)}
                      className="px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs text-slate-100"
                    />
                    <button
                      type="submit"
                      className="self-start px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 flex items-center gap-1.5"
                    >
                      <PlusCircle className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Сохранить команду</span>
                    </button>
                  </form>
                </div>

                {/* Connect Bot to Rooms & Recent Webhook Logs */}
                <div className="flex flex-col gap-4">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-200 mb-2">
                      Подключение к группам и каналам
                    </h4>
                    <div className="flex flex-col gap-1.5">
                      {chats.map((chat) => {
                        const isAttached = (chat.botIds || []).includes(selectedBot.id);
                        return (
                          <div
                            key={chat.id}
                            className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-800 text-xs"
                          >
                            <span className="text-slate-200 truncate">{chat.title}</span>
                            <button
                              onClick={() => handleToggleBotInChat(chat.id)}
                              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                                isAttached
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              {isAttached ? 'Подключен' : 'Подключить'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold text-slate-200 mb-2">
                      Журнал вызовов API
                    </h4>
                    <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
                      {(selectedBot.logs || []).map((log) => (
                        <div
                          key={log.id}
                          className="px-3 py-2 rounded bg-slate-950 border border-slate-800/80 text-[11px] font-mono"
                        >
                          <div className="flex items-center justify-between text-slate-400">
                            <span>
                              {log.method} {log.endpoint}
                            </span>
                            <span className="text-emerald-400">HTTP {log.status}</span>
                          </div>
                          <div className="text-slate-300 mt-0.5 truncate">{log.summary}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
