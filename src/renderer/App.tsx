import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  BatteryCharging,
  Cable,
  Check,
  ChevronDown,
  ChevronUp,
  Coffee,
  Clipboard,
  CopyPlus,
  Edit3,
  Gauge,
  Maximize,
  Maximize2,
  Minus,
  Moon,
  MonitorUp,
  Pin,
  Play,
  Power,
  Radio,
  RefreshCw,
  ScanLine,
  Settings,
  Shield,
  Square,
  Sun,
  Terminal,
  Volume2,
  Wifi,
  X
} from 'lucide-react';
import type { AppSettings, CommandPreview, Device, Diagnostics, LaunchProfile, ReverseServerStatus, ReverseStreamSettings, Session } from '../shared/types';
import { defaultSettings } from '../shared/profiles';
import { createDemoBridge } from './demoBridge';
import './styles.css';

const studio = window.scrcpyStudio ?? createDemoBridge();

interface ReverseSessionEntry {
  id: string;
  status: 'running' | 'stopped' | 'crashed';
  port: number;
  url?: string;
  codec: ReverseStreamSettings['codec'];
  startedAt: string;
  stoppedAt?: string;
  logs: string[];
}

function deviceLabel(device: Device, aliases?: Record<string, string>) {
  return aliases?.[device.serial] || device.model || device.product || device.serial;
}

function cloneProfile(profile: LaunchProfile): LaunchProfile {
  const cloned = JSON.parse(JSON.stringify(profile)) as LaunchProfile;
  cloned.system = { requiresAdministrator: cloned.system?.requiresAdministrator ?? false };
  return cloned;
}

function sameValue<T>(left: T, right: T) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function networkPrefix(ip?: string) {
  if (!ip) return '';
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts.slice(0, 3).join('.')}.` : '';
}

function reverseCommandLabel(status: ReverseServerStatus) {
  const codec = status.stream.codec === 'webrtc-h264' ? 'H.264/WebRTC' : 'MJPEG';
  return `reverse-remote --port ${status.port} --codec ${codec} --fps ${status.stream.fps} --max-size ${status.stream.maxWidth}x${status.stream.maxHeight}`;
}

function NumberStepper({
  value,
  placeholder,
  min,
  max,
  step = 1,
  onChange
}: {
  value: number | undefined;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number | undefined) => void;
}) {
  const textValue = value === undefined || Number.isNaN(value) ? '' : String(value);
  const clamp = (next: number) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, next));
  const bump = (direction: 1 | -1) => onChange(clamp((value ?? 0) + step * direction));

  return (
    <div className="numberStepper">
      <input
        inputMode="numeric"
        value={textValue}
        placeholder={placeholder}
        onChange={(event) => {
          const next = event.target.value.trim();
          onChange(next === '' ? undefined : clamp(Number(next)));
        }}
      />
      <div className="stepperButtons" aria-hidden="true">
        <button type="button" tabIndex={-1} onClick={() => bump(1)}><ChevronUp size={13} /></button>
        <button type="button" tabIndex={-1} onClick={() => bump(-1)}><ChevronDown size={13} /></button>
      </div>
    </div>
  );
}

function ToggleCard({
  icon,
  label,
  checked,
  onChange
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggleCard">
      <span className="toggleText">
        {icon}
        <span>{label}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function App() {
  const [settings, setSettings] = useState<AppSettings>({ ...defaultSettings });
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedSerial, setSelectedSerial] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState(defaultSettings.defaultProfileId);
  const [draftProfile, setDraftProfile] = useState<LaunchProfile>(cloneProfile(defaultSettings.profiles[0]));
  const [sessions, setSessions] = useState<Session[]>([]);
  const [preview, setPreview] = useState<CommandPreview | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [wirelessHost, setWirelessHost] = useState('');
  const [pairHost, setPairHost] = useState('');
  const [pairCode, setPairCode] = useState('');
  const [bridgePort, setBridgePort] = useState(5555);
  const [profileNameDraft, setProfileNameDraft] = useState('');
  const [isNamingProfile, setIsNamingProfile] = useState(false);
  const [renamingSerial, setRenamingSerial] = useState('');
  const [deviceNameDraft, setDeviceNameDraft] = useState('');
  const [reverseStatus, setReverseStatus] = useState<ReverseServerStatus>({
    running: false,
    port: 7420,
    reverseAudioBeta: true,
    stream: { codec: 'webrtc-h264', fps: 60, quality: 68, maxWidth: 1920, maxHeight: 1080 }
  });
  const [reversePort, setReversePort] = useState(7420);
  const [reverseStream, setReverseStream] = useState<ReverseStreamSettings>({ codec: 'webrtc-h264', fps: 60, quality: 68, maxWidth: 1920, maxHeight: 1080 });
  const [reverseSessions, setReverseSessions] = useState<ReverseSessionEntry[]>([]);
  const initialized = useRef(false);
  const userEditedDraft = useRef(false);
  const previewRequestId = useRef(0);
  const activeReverseSessionId = useRef<string | null>(null);

  const selectedDevice = devices.find((device) => device.serial === selectedSerial);
  const activeSession = sessions.find((session) => session.deviceSerial === selectedSerial && session.status === 'running');
  const canConnectHost = /^[^:\s]+:\d+$/.test(wirelessHost.trim());

  const selectedProfile = useMemo(
    () => settings.profiles.find((profile) => profile.id === selectedProfileId) ?? settings.profiles[0],
    [selectedProfileId, settings.profiles]
  );

  async function refreshDevices() {
    try {
      const nextDevices = await studio.listDevices();
      setDevices((current) => (sameValue(current, nextDevices) ? current : nextDevices));
      if (!selectedSerial && nextDevices[0]) setSelectedSerial(nextDevices[0].serial);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function refreshAll() {
    const [nextSettings, nextSessions, nextReverseStatus, nextDiagnostics] = await Promise.all([
      studio.getSettings(),
      studio.listSessions(),
      studio.getReverseStatus(),
      studio.getDiagnostics()
    ]);
    setSettings((current) => (sameValue(current, nextSettings) ? current : nextSettings));
    setSessions((current) => (sameValue(current, nextSessions) ? current : nextSessions));
    setReverseStatus((current) => (sameValue(current, nextReverseStatus) ? current : nextReverseStatus));
    setReversePort((current) => (current === (nextReverseStatus.port || 7420) ? current : nextReverseStatus.port || 7420));
    setReverseStream((current) => (sameValue(current, nextReverseStatus.stream) ? current : nextReverseStatus.stream));
    setDiagnostics((current) => (sameValue(current, nextDiagnostics) ? current : nextDiagnostics));
    if (nextReverseStatus.running && !activeReverseSessionId.current) {
      const id = crypto.randomUUID();
      activeReverseSessionId.current = id;
      setReverseSessions((current) => [
        {
          id,
          status: 'running',
          port: nextReverseStatus.port,
          url: nextReverseStatus.url,
          codec: nextReverseStatus.stream.codec,
          startedAt: new Date().toISOString(),
          logs: ['Detected running reverse remote.']
        },
        ...current
      ]);
    }
    setWirelessHost((current) => current || networkPrefix(nextDiagnostics.localIpv4Addresses?.[0]));
    if (!initialized.current) {
      const initialProfile = nextSettings.profiles.find((p) => p.id === nextSettings.defaultProfileId) ?? nextSettings.profiles[0];
      setSelectedProfileId(nextSettings.defaultProfileId);
      setDraftProfile(cloneProfile(initialProfile));
      initialized.current = true;
    }
    await refreshDevices();
  }

  useEffect(() => {
    void refreshAll();
    const unsubscribe = studio.onSessionChanged((session) => {
      setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => void refreshDevices(), settings.pollIntervalMs || 5000);
    return () => window.clearInterval(timer);
  }, [settings.pollIntervalMs, selectedSerial]);

  useEffect(() => {
    if (userEditedDraft.current) return;
    setDraftProfile((current) => (sameValue(current, selectedProfile) ? current : cloneProfile(selectedProfile)));
  }, [selectedProfile]);

  useEffect(() => {
    if (!selectedSerial) {
      setPreview(null);
      return;
    }
    const requestId = ++previewRequestId.current;
    const timer = window.setTimeout(() => {
      void studio.previewCommand(selectedSerial, draftProfile)
        .then((nextPreview) => {
          if (requestId === previewRequestId.current) {
            setPreview((current) => (sameValue(current, nextPreview) ? current : nextPreview));
          }
        })
        .catch(() => {
          if (requestId === previewRequestId.current) setPreview(null);
        });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [selectedSerial, draftProfile]);

  async function runAction(action: () => Promise<string | Session>, success: string) {
    setBusy(true);
    setNotice('');
    try {
      const result = await action();
      setNotice(typeof result === 'string' ? result || success : success);
      await refreshDevices();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function updateDraft(mutator: (profile: LaunchProfile) => void) {
    userEditedDraft.current = true;
    setDraftProfile((current) => {
      const next = cloneProfile(current);
      mutator(next);
      return next;
    });
  }

  async function createNamedProfile() {
    const cleanName = profileNameDraft.trim();
    if (!cleanName) {
      setIsNamingProfile(true);
      return;
    }

    const idBase = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'profile';
    let id = idBase;
    let index = 2;
    while (settings.profiles.some((profile) => profile.id === id)) {
      id = `${idBase}-${index}`;
      index += 1;
    }

    const newProfile = {
      ...cloneProfile(draftProfile),
      id,
      name: cleanName,
      description: `Custom profile based on ${selectedProfile.name}.`
    };
    const next = await studio.saveSettings({
      ...settings,
      profiles: [...settings.profiles, newProfile],
      defaultProfileId: id
    });
    setSettings(next);
    setSelectedProfileId(id);
    userEditedDraft.current = false;
    setDraftProfile(cloneProfile(newProfile));
    setProfileNameDraft('');
    setIsNamingProfile(false);
    setNotice(`Profile "${cleanName}" created.`);
  }

  async function saveDeviceAlias(serial: string) {
    const nextAliases = { ...(settings.deviceAliases ?? {}) };
    const cleanName = deviceNameDraft.trim();
    if (cleanName) {
      nextAliases[serial] = cleanName;
    } else {
      delete nextAliases[serial];
    }
    const next = await studio.saveSettings({ ...settings, deviceAliases: nextAliases });
    setSettings(next);
    setRenamingSerial('');
    setDeviceNameDraft('');
  }

  async function toggleTheme() {
    const nextTheme = settings.theme === 'light' ? 'dark' : 'light';
    const next = await studio.saveSettings({ ...settings, theme: nextTheme });
    setSettings(next);
  }

  async function toggleReverseServer() {
    setBusy(true);
    setNotice('');
    try {
      if (reverseStatus.running) {
        const next = await studio.stopReverseServer();
        setReverseStatus(next);
        const id = activeReverseSessionId.current;
        if (id) {
          setReverseSessions((current) => current.map((session) => (
            session.id === id
              ? { ...session, status: 'stopped', stoppedAt: new Date().toISOString(), logs: ['Reverse remote stopped.', ...session.logs] }
              : session
          )));
          activeReverseSessionId.current = null;
        }
        setNotice('Reverse remote stopped.');
        return;
      }

      const next = await studio.startReverseServer(reversePort, selectedSerial || undefined);
      setReverseStatus(next);
      const id = crypto.randomUUID();
      activeReverseSessionId.current = id;
      setReverseSessions((current) => [
        {
          id,
          status: 'running',
          port: next.port,
          url: next.url,
          codec: next.stream.codec,
          startedAt: new Date().toISOString(),
          logs: [
            next.adbReverseSerial ? `ADB reverse active for ${next.adbReverseSerial}.` : 'Listening on the local network.',
            reverseCommandLabel(next)
          ]
        },
        ...current
      ]);
      setNotice(`Reverse remote running at ${next.url}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice(message);
      setReverseSessions((current) => [
        {
          id: crypto.randomUUID(),
          status: 'crashed',
          port: reversePort,
          codec: reverseStream.codec,
          startedAt: new Date().toISOString(),
          stoppedAt: new Date().toISOString(),
          logs: [message]
        },
        ...current
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function applyReverseStreamSettings() {
    setBusy(true);
    setNotice('');
    try {
      if (!studio.setReverseStreamSettings) {
        setNotice('This running app instance has an old preload bridge. Restart Scrcpy Studio to enable stream settings.');
        return;
      }
      const next = await studio.setReverseStreamSettings(reverseStream);
      setReverseStatus(next);
      setReverseStream(next.stream);
      const id = activeReverseSessionId.current;
      if (id) {
        setReverseSessions((current) => current.map((session) => (
          session.id === id
            ? { ...session, codec: next.stream.codec, logs: [`Stream updated: ${reverseCommandLabel(next)}`, ...session.logs] }
            : session
        )));
      }
      setNotice(`Reverse stream set to ${next.stream.codec}, ${next.stream.fps} FPS, quality ${next.stream.quality}, ${next.stream.maxWidth}x${next.stream.maxHeight}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function installRemoteApp() {
    if (!selectedSerial) return;
    if (!studio.installRemoteApp) {
      setNotice('This running app instance has an old preload bridge. Restart Scrcpy Studio to enable Android install/open.');
      return;
    }
    await runAction(() => studio.installRemoteApp(selectedSerial, reversePort), 'Remote Android app installed and opened.');
    const next = await studio.getReverseStatus();
    setReverseStatus(next);
    setReverseStream(next.stream);
    const id = activeReverseSessionId.current;
    if (id) {
      setReverseSessions((current) => current.map((session) => (
        session.id === id
          ? { ...session, logs: [`Android app installed/opened on ${selectedSerial}.`, ...session.logs] }
          : session
      )));
    }
  }

  return (
    <main className="appShell" data-theme={settings.theme ?? 'dark'}>
      <header className="appTitlebar">
        <div className="appMark" aria-hidden="true">
          <span className="markMonitor" />
          <span className="markStand" />
          <span className="markPhone" />
        </div>
        <strong>Scrcpy Studio</strong>
        <button className="themeButton" onClick={() => void toggleTheme()} title="Toggle dark/light mode">
          {settings.theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          {settings.theme === 'light' ? 'Dark' : 'Light'}
        </button>
        <div className="windowControls">
          <button type="button" title="Minimize" onClick={() => void studio.minimizeWindow()}>
            <Minus size={15} />
          </button>
          <button type="button" title="Maximize" onClick={() => void studio.toggleMaximizeWindow()}>
            <Maximize2 size={14} />
          </button>
          <button type="button" title="Close" className="closeButton" onClick={() => void studio.closeWindow()}>
            <X size={15} />
          </button>
        </div>
      </header>
      <aside className="sidebar">
        <div className="sideSectionTitle">Devices</div>

        <button className="primaryButton" onClick={() => void refreshDevices()} disabled={busy}>
          <RefreshCw size={16} /> Refresh devices
        </button>

        <section className="deviceList">
          {devices.length === 0 && <div className="empty">No ADB devices detected.</div>}
          {devices.map((device) => (
            <button
              key={device.serial}
              className={`deviceItem ${device.serial === selectedSerial ? 'selected' : ''}`}
              onClick={() => setSelectedSerial(device.serial)}
            >
              {device.transport === 'wireless' ? <Wifi size={18} /> : <Cable size={18} />}
              <span>
                {renamingSerial === device.serial ? (
                  <span className="deviceRename" onClick={(event) => event.stopPropagation()}>
                    <input
                      autoFocus
                      value={deviceNameDraft}
                      placeholder={device.model || device.serial}
                      onChange={(event) => setDeviceNameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void saveDeviceAlias(device.serial);
                        if (event.key === 'Escape') setRenamingSerial('');
                      }}
                    />
                    <button type="button" onClick={() => void saveDeviceAlias(device.serial)}><Check size={13} /></button>
                  </span>
                ) : (
                  <strong
                    role="button"
                    tabIndex={0}
                    title="Rename device"
                    onClick={(event) => {
                      event.stopPropagation();
                      setRenamingSerial(device.serial);
                      setDeviceNameDraft(settings.deviceAliases?.[device.serial] ?? device.model ?? '');
                    }}
                  >
                    {deviceLabel(device, settings.deviceAliases)}
                    <Edit3 size={12} />
                  </strong>
                )}
                <small>{device.serial}</small>
              </span>
              <em className={device.state}>{device.state}</em>
            </button>
          ))}
        </section>

        <div className="sidebarDivider" />
        <div className="sideSectionTitle">Bridges</div>
        <section className="bridgePanel">
          <label>
            Wireless port
            <NumberStepper value={bridgePort} min={1} max={65535} onChange={(value) => setBridgePort(value ?? 5555)} />
          </label>
          <button disabled={!selectedSerial || busy} onClick={() => void runAction(() => studio.connectWireless(selectedSerial, bridgePort), 'Wireless bridge enabled.')}>
            <Radio size={16} /> Enable TCP/IP
          </button>
          <label>
            Connect host
            <input value={wirelessHost} placeholder="192.168.1.22:5555" onChange={(event) => setWirelessHost(event.target.value)} />
          </label>
          <p className="bridgeHint">
            PC network: {diagnostics?.localIpv4Addresses?.[0] ?? 'unknown'}. Use your phone's Wi-Fi IP with port {bridgePort}.
          </p>
          <button disabled={!canConnectHost || busy} onClick={() => void runAction(() => studio.connectHost(wirelessHost), 'Connected.')}>
            <Wifi size={16} /> Connect
          </button>
          <div className="pairGrid">
            <input value={pairHost} placeholder="host:port" onChange={(event) => setPairHost(event.target.value)} />
            <input value={pairCode} placeholder="code" onChange={(event) => setPairCode(event.target.value)} />
          </div>
          <button
            disabled={!pairHost || !pairCode || busy}
            onClick={() => {
              const [host, port] = pairHost.split(':');
              void runAction(() => studio.pairDevice(host, Number(port), pairCode), 'Paired.');
            }}
          >
            <Clipboard size={16} /> Pair
          </button>
          <button disabled={busy} onClick={() => void runAction(() => studio.restartAdb(), 'ADB restarted.')}>
            <Power size={16} /> Restart ADB
          </button>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{selectedDevice ? deviceLabel(selectedDevice, settings.deviceAliases) : 'Ready when your phone is'}</h1>
            <p>{selectedDevice ? `${selectedDevice.transport} bridge - ${selectedDevice.state}` : 'Connect by USB or wireless ADB to begin.'}</p>
          </div>
          <div className="topActions">
            <button disabled={!selectedSerial || busy} onClick={() => void runAction(() => studio.startSession(selectedSerial, draftProfile), 'Session started.')}>
              <Play size={16} /> Start
            </button>
            <button disabled={!activeSession || busy} onClick={() => activeSession && void runAction(() => studio.stopSession(activeSession.id), 'Session stopped.')}>
              <Square size={16} /> Stop
            </button>
          </div>
        </header>

        {notice && <div className="notice">{notice}</div>}

        <div className="contentGrid">
          <section className="panel controlsPanel">
            <div className="panelHeader">
              <h2><Gauge size={18} /> Launch profile</h2>
              {isNamingProfile ? (
                <div className="profileNameBox">
                  <input
                    autoFocus
                    value={profileNameDraft}
                    placeholder="Profile name"
                    onChange={(event) => setProfileNameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void createNamedProfile();
                      if (event.key === 'Escape') setIsNamingProfile(false);
                    }}
                  />
                  <button onClick={() => void createNamedProfile()}><Check size={15} /> Create</button>
                </div>
              ) : (
                <button onClick={() => setIsNamingProfile(true)}><CopyPlus size={16} /> New preset</button>
              )}
            </div>
            <div className="profileTabs">
              {settings.profiles.map((profile) => (
                <button
                  key={profile.id}
                  className={profile.id === selectedProfileId ? 'active' : ''}
                  onClick={() => {
                    userEditedDraft.current = false;
                    setSelectedProfileId(profile.id);
                    setDraftProfile(cloneProfile(profile));
                  }}
                >
                  {profile.name}
                </button>
              ))}
            </div>
            <p className="profileDescription">{draftProfile.description}</p>

            <div className="controlGrid">
              <label>
                Max size
                <NumberStepper value={draftProfile.video.maxSize} min={0} step={64} onChange={(value) => updateDraft((p) => (p.video.maxSize = value || undefined))} />
              </label>
              <label>
                Bitrate Mbps
                <NumberStepper value={draftProfile.video.bitRateMbps} min={1} step={1} onChange={(value) => updateDraft((p) => (p.video.bitRateMbps = value || undefined))} />
              </label>
              <label>
                Max FPS
                <NumberStepper value={draftProfile.video.maxFps} min={1} step={5} onChange={(value) => updateDraft((p) => (p.video.maxFps = value || undefined))} />
              </label>
              <label>
                Display ID
                <NumberStepper value={draftProfile.video.displayId} min={0} onChange={(value) => updateDraft((p) => (p.video.displayId = value))} />
              </label>
              <label>
                Orientation
                <select value={draftProfile.video.orientation ?? 'unlocked'} onChange={(event) => updateDraft((p) => (p.video.orientation = event.target.value as LaunchProfile['video']['orientation']))}>
                  <option value="unlocked">Unlocked</option>
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </label>
              <label>
                Crop
                <input value={draftProfile.video.crop ?? ''} placeholder="1080:1920:0:0" onChange={(event) => updateDraft((p) => (p.video.crop = event.target.value || undefined))} />
              </label>
            </div>

            <div className="toggleGrid">
              <ToggleCard icon={<Moon size={16} />} label="Screen off" checked={draftProfile.input.turnScreenOff} onChange={(checked) => updateDraft((p) => (p.input.turnScreenOff = checked))} />
              <ToggleCard icon={<Coffee size={16} />} label="Stay awake" checked={draftProfile.input.stayAwake} onChange={(checked) => updateDraft((p) => (p.input.stayAwake = checked))} />
              <ToggleCard icon={<Power size={16} />} label="Power on" checked={draftProfile.input.powerOn} onChange={(checked) => updateDraft((p) => (p.input.powerOn = checked))} />
              <ToggleCard icon={<Clipboard size={16} />} label="Clipboard sync" checked={draftProfile.input.clipboard} onChange={(checked) => updateDraft((p) => (p.input.clipboard = checked))} />
              <ToggleCard icon={<Volume2 size={16} />} label="Audio" checked={draftProfile.audio.enabled} onChange={(checked) => updateDraft((p) => (p.audio.enabled = checked))} />
              <ToggleCard icon={<Pin size={16} />} label="Always on top" checked={draftProfile.window.alwaysOnTop} onChange={(checked) => updateDraft((p) => (p.window.alwaysOnTop = checked))} />
              <ToggleCard icon={<ScanLine size={16} />} label="Borderless" checked={draftProfile.window.borderless} onChange={(checked) => updateDraft((p) => (p.window.borderless = checked))} />
              <ToggleCard icon={<Maximize size={16} />} label="Fullscreen" checked={draftProfile.window.fullscreen} onChange={(checked) => updateDraft((p) => (p.window.fullscreen = checked))} />
              <ToggleCard icon={<Shield size={16} />} label="Administrator / background" checked={draftProfile.system?.requiresAdministrator ?? false} onChange={(checked) => updateDraft((p) => { p.system = { requiresAdministrator: checked }; })} />
            </div>

            <label className="wideLabel">
              Extra scrcpy args
              <input value={draftProfile.extraArgs} placeholder='--shortcut-mod=lctrl --render-driver=direct3d' onChange={(event) => updateDraft((p) => (p.extraArgs = event.target.value))} />
            </label>

            <section className="reversePanel">
              <div>
                <h2><MonitorUp size={18} /> Reverse remote</h2>
                <p>View and control this Windows desktop from your phone while Scrcpy Studio is open.</p>
              </div>
              <div className="reverseControls">
                <label>
                  Port
                  <NumberStepper value={reversePort} min={1024} max={65535} onChange={(value) => setReversePort(value ?? 7420)} />
                </label>
                <button disabled={busy} onClick={() => void toggleReverseServer()}>
                  <Power size={16} /> {reverseStatus.running ? 'Stop remote' : 'Start remote'}
                </button>
              </div>
              <div className="reverseUrl">
                <code>{reverseStatus.running ? reverseStatus.url : 'Start remote to generate a phone URL.'}</code>
                <button
                  disabled={!reverseStatus.url}
                  onClick={() => reverseStatus.url && void navigator.clipboard?.writeText(reverseStatus.url)}
                >
                  <Clipboard size={15} /> Copy
                </button>
              </div>
              <small>
                {reverseStatus.adbReverseSerial
                  ? `USB helper active: open ${reverseStatus.localUrl ?? reverseStatus.url ?? `http://127.0.0.1:${reverseStatus.port}`} on the phone.`
                  : 'Same Wi-Fi works directly. USB devices also get adb reverse when selected.'} {reverseStream.codec === 'webrtc-h264' ? 'Android uses WebRTC/H.264 with MJPEG as fallback.' : 'MJPEG is the compatibility fallback.'}
              </small>
              <div className="reverseTuning">
                <label>
                  Codec
                  <select value={reverseStream.codec} onChange={(event) => setReverseStream((current) => ({ ...current, codec: event.target.value as ReverseStreamSettings['codec'] }))}>
                    <option value="webrtc-h264">H.264/WebRTC</option>
                    <option value="mjpeg">MJPEG fallback</option>
                  </select>
                </label>
                <label>
                  FPS
                  <NumberStepper value={reverseStream.fps} min={1} max={60} onChange={(value) => setReverseStream((current) => ({ ...current, fps: value ?? 60 }))} />
                </label>
                <label>
                  Quality
                  <NumberStepper value={reverseStream.quality} min={30} max={95} onChange={(value) => setReverseStream((current) => ({ ...current, quality: value ?? 68 }))} />
                </label>
                <label>
                  Max width
                  <NumberStepper value={reverseStream.maxWidth} min={320} max={7680} step={160} onChange={(value) => setReverseStream((current) => ({ ...current, maxWidth: value ?? 1920 }))} />
                </label>
                <label>
                  Max height
                  <NumberStepper value={reverseStream.maxHeight} min={240} max={4320} step={90} onChange={(value) => setReverseStream((current) => ({ ...current, maxHeight: value ?? 1080 }))} />
                </label>
              </div>
              <div className="reverseActions">
                <button disabled={busy} onClick={() => void applyReverseStreamSettings()}>
                  <Gauge size={16} /> Apply stream
                </button>
                <button disabled={!selectedSerial || busy} onClick={() => void installRemoteApp()}>
                  <MonitorUp size={16} /> Install/Open Android app
                </button>
              </div>
            </section>
          </section>

          <section className="panel commandPanel">
            <h2><Terminal size={18} /> Command preview</h2>
            <pre>{preview?.command ?? 'Select a device to preview the scrcpy command.'}</pre>
            <h2><Activity size={18} /> Sessions</h2>
            <div className="sessionList">
              {reverseSessions.slice(0, 5).map((session) => (
                <article key={session.id} className={`sessionItem reverseSessionItem ${session.status}`}>
                  <header>
                    <strong>{session.status}</strong>
                    <small>reverse:{session.port}</small>
                  </header>
                  <code>{`reverse-remote --port ${session.port} --codec ${session.codec}${session.url ? ` --url ${session.url}` : ''}`}</code>
                  <div className="logs">
                    {session.logs.slice(0, 5).map((log, index) => (
                      <span key={`${session.id}-${index}`} className="system">{log}</span>
                    ))}
                  </div>
                </article>
              ))}
              {sessions.slice(0, 6).map((session) => (
                <article key={session.id} className={`sessionItem ${session.status}`}>
                  <header>
                    <strong>{session.status}</strong>
                    <small>{session.deviceSerial}</small>
                  </header>
                  <code>{session.command}</code>
                  <div className="logs">
                    {session.logs.slice(-5).map((log, index) => (
                      <span key={`${log.at}-${index}`} className={log.stream}>{log.text}</span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>

        <footer className="statusBar">
          <span><Settings size={14} /> ADB: {diagnostics?.adbPath ?? 'checking'}</span>
          <span><BatteryCharging size={14} /> scrcpy: {diagnostics?.scrcpyPath ?? 'checking'}</span>
          <span>Poll: {settings.pollIntervalMs}ms</span>
          <span className="statusDot" />
        </footer>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
