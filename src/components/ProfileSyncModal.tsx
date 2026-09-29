import React, { useState } from 'react';
import {
  Shield,
  Smartphone,
  Laptop,
  RefreshCw,
  Key,
  Copy,
  Check,
  LogOut,
  X,
  Trash2,
  Link2,
} from 'lucide-react';
import { DeviceSession, UserProfile } from '../types';
import { generateIdentityKeyPair } from '../utils/crypto';

interface ProfileSyncModalProps {
  currentUser: UserProfile;
  userEmail?: string;
  allUsers: UserProfile[];
  devices: DeviceSession[];
  onClose: () => void;
  onUpdateProfile: (patch: Partial<UserProfile>) => Promise<void>;
  onLinkDeviceByCode: (syncCode: string, deviceName: string) => Promise<string | null>;
  onRevokeDevice: (deviceId: string) => void;
  onSignOut: () => void;
}

export const ProfileSyncModal: React.FC<ProfileSyncModalProps> = ({
  currentUser,
  userEmail,
  allUsers,
  devices,
  onClose,
  onUpdateProfile,
  onLinkDeviceByCode,
  onRevokeDevice,
  onSignOut,
}) => {
  const [activeTab, setActiveTab] = useState<'profile' | 'sync'>('profile');

  // Profile edit state
  const [displayName, setDisplayName] = useState(currentUser.displayName);
  const [handle, setHandle] = useState(currentUser.handle);
  const [bio, setBio] = useState(currentUser.bio);
  const [savedNotice, setSavedNotice] = useState(false);
  const [copiedSync, setCopiedSync] = useState(false);

  // Link device state
  const [inputSyncCode, setInputSyncCode] = useState('');
  const [inputDeviceName, setInputDeviceName] = useState('ClickChat Browser Node #2');
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const userDevices = devices.filter((d) => d.userId === currentUser.id);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    await onUpdateProfile({
      id: currentUser.id,
      displayName: displayName.trim() || currentUser.displayName,
      handle: handle.trim().replace(/^@/, '') || currentUser.handle,
      bio: bio.trim(),
    });
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  const handleRegenerateKeys = async () => {
    const { publicKeyHex, fingerprint } = await generateIdentityKeyPair();
    await onUpdateProfile({
      id: currentUser.id,
      publicKeyHex,
      publicKeyFingerprint: fingerprint,
    });
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  const copySyncCode = () => {
    navigator.clipboard.writeText(currentUser.syncCode);
    setCopiedSync(true);
    setTimeout(() => setCopiedSync(false), 1800);
  };

  const handleLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputSyncCode.trim()) return;
    const err = await onLinkDeviceByCode(inputSyncCode.trim(), inputDeviceName.trim());
    if (err) {
      setSyncMessage(err);
    } else {
      setSyncMessage('Устройство успешно синхронизировано с вашим аккаунтом!');
      setInputSyncCode('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0B0F17] border border-slate-800 rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#111827]">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-emerald-400" />
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Профиль и активные устройства
              </h2>
              <p className="text-xs text-slate-400">
                {userEmail ? userEmail : 'Настройки аккаунта и сессий'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onSignOut}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-red-950/70 hover:text-red-300 text-xs font-medium text-slate-300 flex items-center gap-1.5 transition-colors"
              title="Выйти из аккаунта"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Выйти</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 px-6 py-3 bg-[#0E1420] border-b border-slate-800">
          <button
            onClick={() => setActiveTab('profile')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'profile'
                ? 'bg-emerald-500 text-slate-950 font-semibold'
                : 'text-slate-400 hover:text-slate-200 bg-slate-900'
            }`}
          >
            Профиль
          </button>
          <button
            onClick={() => setActiveTab('sync')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'sync'
                ? 'bg-emerald-500 text-slate-950 font-semibold'
                : 'text-slate-400 hover:text-slate-200 bg-slate-900'
            }`}
          >
            Устройства ({userDevices.length})
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1">
          {activeTab === 'profile' && (
            <div className="flex flex-col gap-6">
              <form onSubmit={handleSaveProfile} className="flex flex-col gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Отображаемое имя аккаунта
                    </label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Уникальный идентификатор (@handle)
                    </label>
                    <input
                      type="text"
                      value={handle}
                      onChange={(e) => setHandle(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    О себе
                  </label>
                  <input
                    type="text"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold transition-colors"
                  >
                    Сохранить
                  </button>
                  {savedNotice && (
                    <span className="text-xs text-emerald-400">
                      Изменения сохранены
                    </span>
                  )}
                </div>
              </form>

              {/* Cryptographic Identity Card */}
              <div className="p-4 rounded-lg bg-slate-900/80 border border-slate-800 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                    <Key className="w-4 h-4 text-emerald-400" />
                    <span>Отпечаток открытого ключа личности (ECDH / SHA-256)</span>
                  </div>
                  <button
                    onClick={handleRegenerateKeys}
                    className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Перевыпустить ключевую пару</span>
                  </button>
                </div>

                <div className="p-3 rounded bg-slate-950 border border-slate-800 font-mono text-xs text-emerald-300 tracking-wider tabular-nums">
                  {currentUser.publicKeyFingerprint}
                </div>

                <div className="text-xs text-slate-400">
                  Публичный ключ (Hex):{' '}
                  <span className="font-mono text-slate-300 break-all">
                    {currentUser.publicKeyHex}
                  </span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'sync' && (
            <div className="flex flex-col gap-6">
              {/* Sync Code Box */}
              <div className="p-4 rounded-lg bg-slate-900/80 border border-slate-800 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100">
                      Код связки для синхронизации между устройствами
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Используйте этот код на втором устройстве для мгновенной авторизации сессии и синхронизации ключей E2EE
                    </p>
                  </div>
                  <button
                    onClick={copySyncCode}
                    className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1.5 whitespace-nowrap"
                  >
                    {copiedSync ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Скопировано</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Копировать код</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="p-3 rounded bg-slate-950 border border-emerald-500/40 font-mono text-sm font-semibold text-emerald-400 tracking-widest text-center tabular-nums">
                  {currentUser.syncCode}
                </div>
              </div>

              {/* Link Another Device via Sync Code */}
              <form
                onSubmit={handleLinkSubmit}
                className="p-4 rounded-lg bg-slate-900/50 border border-slate-800 flex flex-col gap-3"
              >
                <h4 className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-emerald-400" />
                  <span>Зарегистрировать дополнительное устройство по коду синхронизации</span>
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <input
                    type="text"
                    placeholder="Код (напр. CC-...)"
                    value={inputSyncCode}
                    onChange={(e) => setInputSyncCode(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100"
                  />
                  <input
                    type="text"
                    placeholder="Название устройства"
                    value={inputDeviceName}
                    onChange={(e) => setInputDeviceName(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-100"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold"
                  >
                    Привязать устройство
                  </button>
                </div>
                <div className="text-[11px] text-slate-400">
                  Ваш код текущего аккаунта:{' '}
                  <button
                    type="button"
                    onClick={() => setInputSyncCode(currentUser.syncCode)}
                    className="font-mono text-emerald-400 hover:underline"
                  >
                    {currentUser.syncCode}
                  </button>
                  {allUsers.length > 1 && ' · Все участники синхронизированы'}
                </div>
                {syncMessage && (
                  <p className="text-xs text-emerald-400">{syncMessage}</p>
                )}
              </form>

              {/* Active Synced Devices List */}
              <div>
                <h4 className="text-xs font-semibold text-slate-400 mb-2.5">
                  Активные синхронизированные устройства ({userDevices.length})
                </h4>
                <div className="flex flex-col gap-2">
                  {userDevices.map((dev, index) => (
                    <div
                      key={dev.id}
                      className="flex items-center justify-between p-3.5 rounded-lg bg-slate-900/70 border border-slate-800"
                    >
                      <div className="flex items-center gap-3">
                        {dev.deviceName.toLowerCase().includes('mobile') ||
                        dev.deviceName.toLowerCase().includes('pixel') ? (
                          <Smartphone className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <Laptop className="w-4 h-4 text-emerald-400 shrink-0" />
                        )}
                        <div>
                          <div className="text-xs font-semibold text-slate-100">
                            {dev.deviceName}
                            {index === 0 && (
                              <span className="ml-2 text-emerald-400 font-normal">
                                · Текущая сессия
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
                            {dev.platform} · Ключ: {dev.keyFingerprint} · Синхронизировано
                          </div>
                        </div>
                      </div>

                      {userDevices.length > 1 && (
                        <button
                          onClick={() => onRevokeDevice(dev.id)}
                          className="p-1.5 text-slate-400 hover:text-red-400 rounded hover:bg-slate-800"
                          title="Отозвать доступ устройства"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
