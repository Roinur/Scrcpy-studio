import { BrowserWindow, desktopCapturer, screen, session } from 'electron';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import os from 'node:os';
import { promisify } from 'node:util';
import type { ReverseServerStatus, ReverseStreamSettings } from '../shared/types.js';

const execFileAsync = promisify(execFile);
const sleep = promisify(setTimeout);

interface ReverseInput {
  type: 'tap' | 'scroll' | 'key' | 'keyDown' | 'keyUp' | 'keyPress' | 'mouse';
  x?: number;
  y?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  deltaY?: number;
  key?: string;
  action?: 'leftClick' | 'rightClick' | 'middleClick' | 'leftDown' | 'leftUp' | 'rightDown' | 'rightUp';
}

interface DisplayInfo {
  id: string;
  name: string;
  width: number;
  height: number;
  active: boolean;
}

interface WebRtcSignalSession {
  id: string;
  offer: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  clientCandidates: RTCIceCandidateInit[];
  hostCandidates: RTCIceCandidateInit[];
  createdAt: number;
}

interface RemoteActionHandlers {
  startScrcpy?: (serial?: string) => Promise<unknown>;
}

function localAddress() {
  const address = Object.values(os.networkInterfaces())
    .flat()
    .find((entry) => entry && entry.family === 'IPv4' && !entry.internal)?.address;
  return address ?? '127.0.0.1';
}

function readBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 16_384) request.destroy(new Error('Request body too large.'));
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function html(port: number) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Scrcpy Studio Remote</title>
  <style>
    html, body { margin: 0; height: 100%; overflow: hidden; background: #0d0d0d; color: #f4f4f5; font-family: system-ui, sans-serif; }
    main { height: 100%; display: grid; grid-template-rows: 46px minmax(0, 1fr) 64px; }
    header, footer { display: flex; align-items: center; gap: 10px; padding: 0 14px; background: #151515; border-bottom: 1px solid #242424; }
    footer { border-top: 1px solid #242424; border-bottom: 0; }
    section { position: relative; min-height: 0; background: #050505; }
    img { width: 100%; height: 100%; object-fit: contain; touch-action: none; background: #050505; }
    #state { position: absolute; left: 14px; right: 14px; bottom: 14px; padding: 10px 12px; border: 1px solid #2d2d2d; border-radius: 10px; background: rgba(21,21,21,.9); color: #a1a1aa; font-size: 13px; }
    #state.ok { display: none; }
    button { min-height: 38px; border: 1px solid #2d2d2d; border-radius: 10px; color: #f4f4f5; background: #1a1a1a; padding: 0 14px; }
    input { min-width: 0; flex: 1; min-height: 38px; border: 1px solid #2d2d2d; border-radius: 10px; color: #f4f4f5; background: #101010; padding: 0 12px; }
    small { color: #a1a1aa; margin-left: auto; }
  </style>
</head>
<body>
  <main>
    <header><strong>Scrcpy Studio Remote</strong><small>port ${port}</small></header>
    <section>
      <img id="screen" src="/frame.png" alt="Windows screen">
      <div id="state">Waiting for desktop frame...</div>
    </section>
    <footer><input id="keys" placeholder="Type and press enter"><button id="refresh">Refresh</button></footer>
  </main>
  <script>
    const img = document.getElementById('screen');
    const state = document.getElementById('state');
    const keys = document.getElementById('keys');
    let downAt = 0;
    function refresh() { img.src = '/frame.jpg?t=' + Date.now(); }
    img.addEventListener('load', () => { state.className = 'ok'; state.textContent = ''; });
    img.addEventListener('error', () => { state.className = ''; state.textContent = 'Could not load desktop frame. Check that Scrcpy Studio remote is running and the phone can reach this URL.'; });
    async function input(payload) {
      await fetch('/api/input', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      setTimeout(refresh, 80);
    }
    img.addEventListener('pointerdown', () => { downAt = Date.now(); });
    img.addEventListener('pointerup', (event) => {
      const rect = img.getBoundingClientRect();
      if (Date.now() - downAt < 650) input({ type: 'tap', x: event.clientX - rect.left, y: event.clientY - rect.top, viewportWidth: rect.width, viewportHeight: rect.height });
    });
    img.addEventListener('wheel', (event) => input({ type: 'scroll', deltaY: event.deltaY }), { passive: true });
    keys.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && keys.value) {
        input({ type: 'key', key: keys.value });
        keys.value = '';
      }
    });
    document.getElementById('refresh').addEventListener('click', refresh);
    setInterval(refresh, 50);
  </script>
</body>
</html>`;
}

function webRtcClientHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Scrcpy Studio WebRTC</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #000; color: #f4f4f5; font-family: system-ui, sans-serif; }
    video { width: 100vw; height: 100vh; object-fit: contain; background: #000; touch-action: none; }
    #state { position: fixed; left: 14px; right: 14px; bottom: 14px; padding: 10px 12px; border: 1px solid #333; border-radius: 12px; background: rgba(13,13,13,.82); color: #d4d4d8; font-size: 13px; }
    #state.ok { display: none; }
  </style>
</head>
<body>
  <video id="screen" autoplay playsinline muted></video>
  <div id="state">Starting WebRTC stream...</div>
  <script>
    const video = document.getElementById('screen');
    const state = document.getElementById('state');
    let sessionId = null;
    let hostCandidateCursor = 0;

    function setState(text, ok = false) {
      state.textContent = text;
      state.className = ok ? 'ok' : '';
    }

    function preferH264(sdp) {
      const lines = sdp.split('\\r\\n');
      const mLineIndex = lines.findIndex((line) => line.startsWith('m=video'));
      if (mLineIndex < 0) return sdp;
      const h264Payloads = lines
        .filter((line) => /a=rtpmap:\\d+ H264\\/90000/i.test(line))
        .map((line) => line.match(/a=rtpmap:(\\d+)/)?.[1])
        .filter(Boolean);
      if (!h264Payloads.length) return sdp;
      const parts = lines[mLineIndex].split(' ');
      const header = parts.slice(0, 3);
      const payloads = parts.slice(3);
      lines[mLineIndex] = [...header, ...h264Payloads, ...payloads.filter((payload) => !h264Payloads.includes(payload))].join(' ');
      return lines.join('\\r\\n');
    }

    async function postJson(path, body) {
      const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }

    async function start() {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.ontrack = (event) => {
        video.srcObject = event.streams[0];
        setState('', true);
      };
      pc.onconnectionstatechange = () => setState('WebRTC: ' + pc.connectionState, pc.connectionState === 'connected');
      pc.onicecandidate = (event) => {
        if (event.candidate && sessionId) void postJson('/api/webrtc/client-candidate/' + sessionId, event.candidate.toJSON());
      };
      const offer = await pc.createOffer();
      offer.sdp = preferH264(offer.sdp || '');
      await pc.setLocalDescription(offer);
      const created = await postJson('/api/webrtc/offer', pc.localDescription);
      sessionId = created.id;
      while (!pc.remoteDescription) {
        const answerResponse = await fetch('/api/webrtc/answer/' + sessionId);
        if (answerResponse.status === 200) {
          const answer = await answerResponse.json();
          await pc.setRemoteDescription(answer);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 180));
      }
      setInterval(async () => {
        if (!sessionId) return;
        const response = await fetch('/api/webrtc/host-candidates/' + sessionId + '?after=' + hostCandidateCursor);
        if (response.status !== 200) return;
        const data = await response.json();
        hostCandidateCursor = data.next;
        for (const candidate of data.candidates) await pc.addIceCandidate(candidate);
      }, 220);
    }

    function videoPoint(event) {
      const rect = video.getBoundingClientRect();
      const videoWidth = video.videoWidth || rect.width;
      const videoHeight = video.videoHeight || rect.height;
      const scale = Math.min(rect.width / videoWidth, rect.height / videoHeight);
      const drawnWidth = videoWidth * scale;
      const drawnHeight = videoHeight * scale;
      const left = (rect.width - drawnWidth) / 2;
      const top = (rect.height - drawnHeight) / 2;
      const x = (event.clientX - rect.left - left) / scale;
      const y = (event.clientY - rect.top - top) / scale;
      if (x < 0 || y < 0 || x > videoWidth || y > videoHeight) return null;
      return { x, y, viewportWidth: videoWidth, viewportHeight: videoHeight };
    }

    let downAt = 0;
    video.addEventListener('pointerdown', () => { downAt = Date.now(); });
    video.addEventListener('pointerup', (event) => {
      if (Date.now() - downAt > 650) return;
      const point = videoPoint(event);
      if (!point) return;
      void postJson('/api/input', { type: 'tap', ...point });
    });
    video.addEventListener('wheel', (event) => {
      void postJson('/api/input', { type: 'scroll', deltaY: event.deltaY });
    }, { passive: true });

    start().catch((error) => setState(error.message || String(error)));
  </script>
</body>
</html>`;
}

function webRtcHostHtml(settings: ReverseStreamSettings, reverseAudioBeta: boolean) {
  return `<!doctype html>
<html>
<body>
  <script>
    const settings = ${JSON.stringify(settings)};
    const peers = new Map();
    let streamPromise = null;

    async function getStream() {
      if (!streamPromise) {
        streamPromise = navigator.mediaDevices.getDisplayMedia({
          audio: ${reverseAudioBeta ? 'true' : 'false'},
          video: {
            frameRate: { ideal: settings.fps, max: settings.fps },
            width: { max: settings.maxWidth },
            height: { max: settings.maxHeight }
          }
        });
      }
      return streamPromise;
    }

    async function postJson(path, body) {
      const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }

    async function attachClientCandidates(id, pc) {
      let cursor = 0;
      const timer = setInterval(async () => {
        if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
          clearInterval(timer);
          peers.delete(id);
          return;
        }
        const response = await fetch('/api/webrtc/client-candidates/' + id + '?after=' + cursor);
        if (response.status !== 200) return;
        const data = await response.json();
        cursor = data.next;
        for (const candidate of data.candidates) await pc.addIceCandidate(candidate);
      }, 220);
    }

    async function handleOffer(item) {
      if (peers.has(item.id)) return;
      const pc = new RTCPeerConnection({ iceServers: [] });
      peers.set(item.id, pc);
      const stream = await getStream();
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      pc.onicecandidate = (event) => {
        if (event.candidate) void postJson('/api/webrtc/host-candidate/' + item.id, event.candidate.toJSON());
      };
      await pc.setRemoteDescription(item.offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await postJson('/api/webrtc/answer/' + item.id, pc.localDescription);
      void attachClientCandidates(item.id, pc);
    }

    async function poll() {
      try {
        const response = await fetch('/api/webrtc/pending');
        const pending = await response.json();
        for (const item of pending) void handleOffer(item);
      } catch (error) {
        console.error(error);
        void fetch('/api/webrtc/host-error', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: error.message || String(error) }) });
      }
    }
    setInterval(poll, 350);
    void poll();
  </script>
</body>
</html>`;
}

export class ReverseService {
  private server: http.Server | null = null;
  private streamSettings: ReverseStreamSettings = { codec: 'webrtc-h264', fps: 60, quality: 68, maxWidth: 1920, maxHeight: 1080 };
  private reverseAudioBeta = true;
  private status: ReverseServerStatus = { running: false, port: 7420, reverseAudioBeta: this.reverseAudioBeta, stream: this.streamSettings };
  private displayId: string | undefined;
  private webRtcHost: BrowserWindow | null = null;
  private webRtcSessions = new Map<string, WebRtcSignalSession>();
  private actionHandlers: RemoteActionHandlers = {};

  getStatus(): ReverseServerStatus {
    return { ...this.status, reverseAudioBeta: this.reverseAudioBeta, stream: { ...this.streamSettings } };
  }

  setActionHandlers(handlers: RemoteActionHandlers) {
    this.actionHandlers = handlers;
  }

  setStreamSettings(settings: Partial<ReverseStreamSettings>): ReverseServerStatus {
    this.streamSettings = {
      codec: settings.codec ?? this.streamSettings.codec,
      fps: Math.max(1, Math.min(60, Math.round(settings.fps ?? this.streamSettings.fps))),
      quality: Math.max(30, Math.min(95, Math.round(settings.quality ?? this.streamSettings.quality))),
      maxWidth: Math.max(320, Math.min(7680, Math.round(settings.maxWidth ?? this.streamSettings.maxWidth))),
      maxHeight: Math.max(240, Math.min(4320, Math.round(settings.maxHeight ?? this.streamSettings.maxHeight)))
    };
    this.status = { ...this.status, stream: this.streamSettings };
    if (this.status.running) void this.restartWebRtcHost();
    return this.getStatus();
  }

  setReverseAudioBeta(enabled: boolean): ReverseServerStatus {
    this.reverseAudioBeta = enabled;
    this.status = { ...this.status, reverseAudioBeta: this.reverseAudioBeta };
    if (this.status.running) void this.restartWebRtcHost();
    return this.getStatus();
  }

  async start(port: number): Promise<ReverseServerStatus> {
    if (this.server && this.status.port === port) return this.getStatus();
    await this.stop();

    this.server = http.createServer((request, response) => {
      void this.handle(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(port, '0.0.0.0', () => resolve());
    });

    this.status = {
      running: true,
      port,
      url: `http://${localAddress()}:${port}`,
      reverseAudioBeta: this.reverseAudioBeta,
      stream: this.streamSettings
    };
    await this.restartWebRtcHost();
    return this.getStatus();
  }

  async stop(): Promise<ReverseServerStatus> {
    if (!this.server) {
      this.status = { ...this.status, running: false, adbReverseSerial: undefined, stream: this.streamSettings };
      return this.getStatus();
    }
    const server = this.server;
    this.server = null;
    this.webRtcHost?.destroy();
    this.webRtcHost = null;
    this.webRtcSessions.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    this.status = { ...this.status, running: false, adbReverseSerial: undefined, stream: this.streamSettings };
    return this.getStatus();
  }

  setAdbReverseSerial(serial?: string) {
    this.status = { ...this.status, adbReverseSerial: serial };
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    try {
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${this.status.port}`);
      if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(html(this.status.port));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/webrtc') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end(webRtcClientHtml());
        return;
      }
      if (request.method === 'GET' && url.pathname === '/webrtc-host') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end(webRtcHostHtml(this.streamSettings, this.reverseAudioBeta));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/status') {
        this.json(response, this.getStatus());
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/stream') {
        const body = JSON.parse(await readBody(request)) as Partial<ReverseStreamSettings>;
        this.json(response, this.setStreamSettings(body));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/displays') {
        this.json(response, await this.listDisplays());
        return;
      }
      if (url.pathname.startsWith('/api/webrtc/')) {
        await this.handleWebRtc(request, response, url);
        return;
      }
      if (url.pathname.startsWith('/api/actions/')) {
        await this.handleRemoteAction(request, response, url);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/display.png') {
        const png = await this.captureFrame(url.searchParams.get('id') ?? undefined, true);
        response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
        response.end(png);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/frame.png') {
        const png = await this.captureFrame(undefined, false, 'png');
        response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
        response.end(png);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/frame.jpg') {
        const jpg = await this.captureFrame(undefined, false, 'jpg');
        response.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' });
        response.end(jpg);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/stream.mjpg') {
        await this.streamMjpeg(response);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/display') {
        const body = JSON.parse(await readBody(request)) as { displayId?: string };
        this.displayId = body.displayId;
        this.status = { ...this.status, displayId: this.displayId, stream: this.streamSettings };
        void this.restartWebRtcHost();
        this.json(response, this.getStatus());
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/input') {
        const input = JSON.parse(await readBody(request)) as ReverseInput;
        await this.handleInput(input);
        this.status = { ...this.status, lastInputAt: new Date().toISOString() };
        this.json(response, { ok: true });
        return;
      }
      response.writeHead(404);
      response.end('Not found');
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(error instanceof Error ? error.message : String(error));
    }
  }

  private json(response: ServerResponse, data: unknown) {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify(data));
  }

  private activeDisplay() {
    const displays = screen.getAllDisplays();
    return displays.find((display) => String(display.id) === this.displayId) ?? screen.getPrimaryDisplay();
  }

  private async activeSourceId() {
    const display = this.activeDisplay();
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
    const source = sources.find((item) => item.display_id === String(display.id)) ?? sources[0];
    if (!source) throw new Error('No desktop screen source was available.');
    return source.id;
  }

  private async restartWebRtcHost() {
    if (!this.status.running || this.streamSettings.codec !== 'webrtc-h264') {
      this.webRtcHost?.destroy();
      this.webRtcHost = null;
      return;
    }
    this.webRtcHost?.destroy();
    this.webRtcHost = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    });
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === 'media');
    });
    await this.webRtcHost.loadURL(`http://127.0.0.1:${this.status.port}/webrtc-host`);
  }

  private async listDisplays(): Promise<DisplayInfo[]> {
    return screen.getAllDisplays().map((display, index) => ({
      id: String(display.id),
      name: `Monitor ${index + 1}`,
      width: display.size.width,
      height: display.size.height,
      active: String(display.id) === String(this.activeDisplay().id)
    }));
  }

  private async captureFrame(displayId = this.displayId, preview = false, format: 'png' | 'jpg' = 'png') {
    const display = screen.getAllDisplays().find((item) => String(item.id) === displayId) ?? this.activeDisplay();
    const size = display.size;
    const width = preview ? 360 : Math.min(size.width, this.streamSettings.maxWidth);
    const height = preview ? 220 : Math.min(size.height, this.streamSettings.maxHeight);
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height }
    });
    const source = sources.find((item) => item.display_id === String(display.id)) ?? sources[0];
    if (!source) throw new Error('No desktop screen source was available.');
    return format === 'jpg' ? source.thumbnail.toJPEG(this.streamSettings.quality) : source.thumbnail.toPNG();
  }

  private async streamMjpeg(response: ServerResponse) {
    const boundary = 'scrcpy-studio-frame';
    let closed = false;
    response.on('close', () => {
      closed = true;
    });
    response.writeHead(200, {
      'content-type': `multipart/x-mixed-replace; boundary=${boundary}`,
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      connection: 'keep-alive',
      pragma: 'no-cache'
    });

    while (!closed && !response.destroyed) {
      const startedAt = Date.now();
      const frame = await this.captureFrame(undefined, false, 'jpg');
      const header = `--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`;
      const canContinue = response.write(header) && response.write(frame) && response.write('\r\n');
      if (!canContinue) {
        await new Promise<void>((resolve) => response.once('drain', resolve));
      }
      const frameDelay = Math.round(1000 / Math.max(1, this.streamSettings.fps));
      await sleep(Math.max(1, frameDelay - (Date.now() - startedAt)));
    }
  }

  private async handleWebRtc(request: IncomingMessage, response: ServerResponse, url: URL) {
    this.cleanupWebRtcSessions();
    const parts = url.pathname.split('/').filter(Boolean);
    const action = parts[2];
    const id = parts[3];
    if (request.method === 'POST' && action === 'offer') {
      const offer = JSON.parse(await readBody(request)) as RTCSessionDescriptionInit;
      const sessionId = randomUUID();
      this.webRtcSessions.set(sessionId, {
        id: sessionId,
        offer,
        clientCandidates: [],
        hostCandidates: [],
        createdAt: Date.now()
      });
      this.json(response, { id: sessionId });
      return;
    }
    if (request.method === 'GET' && action === 'pending') {
      this.json(
        response,
        [...this.webRtcSessions.values()]
          .filter((item) => !item.answer)
          .map((item) => ({ id: item.id, offer: item.offer }))
      );
      return;
    }
    if (!id) {
      response.writeHead(400);
      response.end('Missing WebRTC session id.');
      return;
    }
    const signal = this.webRtcSessions.get(id);
    if (!signal) {
      response.writeHead(404);
      response.end('Unknown WebRTC session.');
      return;
    }
    if (request.method === 'POST' && action === 'answer') {
      signal.answer = JSON.parse(await readBody(request)) as RTCSessionDescriptionInit;
      this.json(response, { ok: true });
      return;
    }
    if (request.method === 'GET' && action === 'answer') {
      if (!signal.answer) {
        response.writeHead(204);
        response.end();
        return;
      }
      this.json(response, signal.answer);
      return;
    }
    if (request.method === 'POST' && action === 'client-candidate') {
      signal.clientCandidates.push(JSON.parse(await readBody(request)) as RTCIceCandidateInit);
      this.json(response, { ok: true });
      return;
    }
    if (request.method === 'POST' && action === 'host-candidate') {
      signal.hostCandidates.push(JSON.parse(await readBody(request)) as RTCIceCandidateInit);
      this.json(response, { ok: true });
      return;
    }
    if (request.method === 'GET' && action === 'client-candidates') {
      const after = Number(url.searchParams.get('after') ?? 0);
      this.json(response, { candidates: signal.clientCandidates.slice(after), next: signal.clientCandidates.length });
      return;
    }
    if (request.method === 'GET' && action === 'host-candidates') {
      const after = Number(url.searchParams.get('after') ?? 0);
      this.json(response, { candidates: signal.hostCandidates.slice(after), next: signal.hostCandidates.length });
      return;
    }
    response.writeHead(404);
    response.end('Unknown WebRTC endpoint.');
  }

  private async handleRemoteAction(request: IncomingMessage, response: ServerResponse, url: URL) {
    if (request.method !== 'POST') {
      response.writeHead(405);
      response.end('Method not allowed.');
      return;
    }
    const action = url.pathname.split('/').filter(Boolean)[2];
    if (action === 'start-remote') {
      this.json(response, this.getStatus());
      return;
    }
    if (action === 'stop-remote') {
      this.json(response, await this.stop());
      return;
    }
    if (action === 'start-scrcpy') {
      if (!this.actionHandlers.startScrcpy) throw new Error('Start scrcpy is not wired in this build.');
      const body = await readBody(request).catch(() => '');
      const parsed = body ? JSON.parse(body) as { serial?: string } : {};
      const session = await this.actionHandlers.startScrcpy(parsed.serial ?? this.status.adbReverseSerial);
      this.json(response, { ok: true, session });
      return;
    }
    if (action === 'reverse-audio') {
      const body = await readBody(request).catch(() => '');
      const parsed = body ? JSON.parse(body) as { enabled?: boolean } : {};
      this.json(response, this.setReverseAudioBeta(parsed.enabled ?? true));
      return;
    }
    response.writeHead(404);
    response.end('Unknown remote action.');
  }

  private cleanupWebRtcSessions() {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [id, item] of this.webRtcSessions) {
      if (item.createdAt < cutoff) this.webRtcSessions.delete(id);
    }
  }

  private async handleInput(input: ReverseInput) {
    if (process.platform !== 'win32') return;
    if (input.type === 'tap' && input.x !== undefined && input.y !== undefined) {
      const display = this.activeDisplay();
      const width = input.viewportWidth || display.size.width;
      const height = input.viewportHeight || display.size.height;
      const x = Math.round(display.bounds.x + (input.x / width) * display.size.width);
      const y = Math.round(display.bounds.y + (input.y / height) * display.size.height);
      await this.runPowerShell(sendInputMouseScript({ x, y, flags: [0x0002, 0x0004] }));
    }
    if (input.type === 'scroll' && input.deltaY !== undefined) {
      const wheel = Math.max(-720, Math.min(720, Math.round(-input.deltaY)));
      await this.runPowerShell(sendInputMouseScript({ wheel }));
    }
    if ((input.type === 'key' || input.type === 'keyPress') && input.key) {
      await this.sendVirtualKey(input.key, 'press');
    }
    if (input.type === 'keyDown' && input.key) {
      await this.sendVirtualKey(input.key, 'down');
    }
    if (input.type === 'keyUp' && input.key) {
      await this.sendVirtualKey(input.key, 'up');
    }
    if (input.type === 'mouse' && input.action) {
      const flags = mouseFlags(input.action);
      await this.runPowerShell(sendInputMouseScript({ flags }));
    }
  }

  private async sendVirtualKey(key: string, mode: 'press' | 'down' | 'up') {
    const steps = keySteps(key, mode);
    if (!steps.length) {
      const safe = sendKeysValue(key).replaceAll("'", "''");
      await this.runPowerShell(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${safe}')
`);
      return;
    }
    const scriptSteps = steps
      .map((step) => `[InputSend]::Key(${step.vk}, ${step.up ? '$true' : '$false'})`)
      .join('\n');
    await this.runPowerShell(`
Add-Type @'
using System.Runtime.InteropServices;
using System;
public class InputSend {
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public UInt32 type; public InputUnion U; }
  [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public UInt16 wVk; public UInt16 wScan; public UInt32 dwFlags; public UInt32 time; public IntPtr dwExtraInfo; }
  [DllImport("user32.dll", SetLastError=true)] static extern UInt32 SendInput(UInt32 nInputs, INPUT[] pInputs, Int32 cbSize);
  [DllImport("user32.dll")] static extern UInt32 MapVirtualKey(UInt32 uCode, UInt32 uMapType);
  const UInt32 INPUT_KEYBOARD = 1;
  const UInt32 KEYEVENTF_KEYUP = 0x0002;
  const UInt32 KEYEVENTF_SCANCODE = 0x0008;
  public static void Key(byte vk, bool up) {
    INPUT[] input = new INPUT[1];
    input[0].type = INPUT_KEYBOARD;
    input[0].U.ki.wVk = 0;
    input[0].U.ki.wScan = (UInt16)MapVirtualKey(vk, 0);
    input[0].U.ki.dwFlags = KEYEVENTF_SCANCODE | (up ? KEYEVENTF_KEYUP : 0);
    SendInput(1, input, Marshal.SizeOf(typeof(INPUT)));
  }
}
'@
${scriptSteps}
`);
  }

  private async runPowerShell(command: string) {
    await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      windowsHide: true,
      timeout: 5000
    });
  }
}

interface KeyStep {
  vk: number;
  up: boolean;
}

const virtualKeys: Record<string, number> = {
  CTRL: 0x11,
  CONTROL: 0x11,
  ALT: 0x12,
  SHIFT: 0x10,
  TAB: 0x09,
  ENTER: 0x0d,
  ESC: 0x1b,
  ESCAPE: 0x1b,
  BACKSPACE: 0x08,
  DELETE: 0x2e,
  UP: 0x26,
  DOWN: 0x28,
  LEFT: 0x25,
  RIGHT: 0x27,
  SPACE: 0x20,
  WIN: 0x5b
};

function vkForKey(key: string) {
  const normalized = key.trim().toUpperCase();
  if (virtualKeys[normalized]) return virtualKeys[normalized];
  if (/^[A-Z0-9]$/.test(normalized)) return normalized.charCodeAt(0);
  if (/^F([1-9]|1[0-2])$/.test(normalized)) return 0x6f + Number(normalized.slice(1));
  return undefined;
}

function keySteps(key: string, mode: 'press' | 'down' | 'up'): KeyStep[] {
  const parts = key.split('+').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return [];
  const keys = parts.map(vkForKey);
  if (keys.some((vk) => vk === undefined)) return [];
  const vkKeys = keys as number[];
  if (mode === 'down') return vkKeys.map((vk) => ({ vk, up: false }));
  if (mode === 'up') return [...vkKeys].reverse().map((vk) => ({ vk, up: true }));
  return [
    ...vkKeys.map((vk) => ({ vk, up: false })),
    ...[...vkKeys].reverse().map((vk) => ({ vk, up: true }))
  ];
}

function mouseFlags(action: NonNullable<ReverseInput['action']>) {
  const flags: Record<NonNullable<ReverseInput['action']>, number[]> = {
    leftDown: [0x0002],
    leftUp: [0x0004],
    leftClick: [0x0002, 0x0004],
    rightDown: [0x0008],
    rightUp: [0x0010],
    rightClick: [0x0008, 0x0010],
    middleClick: [0x0020, 0x0040]
  };
  return flags[action];
}

function sendInputMouseScript({
  x,
  y,
  flags = [],
  wheel
}: {
  x?: number;
  y?: number;
  flags?: number[];
  wheel?: number;
}) {
  const hasMove = x !== undefined && y !== undefined;
  const move = hasMove
    ? `[InputSend]::MoveAbsolute(${Math.round(x)}, ${Math.round(y)})`
    : '';
  const wheelStep = wheel !== undefined ? `[InputSend]::Mouse(0x0800, ${Math.round(wheel)})` : '';
  const buttonSteps = flags.map((flag) => `[InputSend]::Mouse(${flag}, 0)`).join('\n');
  return `
Add-Type @'
using System.Runtime.InteropServices;
using System;
public class InputSend {
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public UInt32 type; public InputUnion U; }
  [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public Int32 dx; public Int32 dy; public Int32 mouseData; public UInt32 dwFlags; public UInt32 time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct RECT { public Int32 left; public Int32 top; public Int32 right; public Int32 bottom; }
  [DllImport("user32.dll", SetLastError=true)] static extern UInt32 SendInput(UInt32 nInputs, INPUT[] pInputs, Int32 cbSize);
  [DllImport("user32.dll")] static extern Int32 GetSystemMetrics(Int32 nIndex);
  const UInt32 INPUT_MOUSE = 0;
  const UInt32 MOUSEEVENTF_MOVE = 0x0001;
  const UInt32 MOUSEEVENTF_ABSOLUTE = 0x8000;
  const UInt32 MOUSEEVENTF_VIRTUALDESK = 0x4000;
  const Int32 SM_XVIRTUALSCREEN = 76;
  const Int32 SM_YVIRTUALSCREEN = 77;
  const Int32 SM_CXVIRTUALSCREEN = 78;
  const Int32 SM_CYVIRTUALSCREEN = 79;
  public static void MoveAbsolute(int x, int y) {
    int left = GetSystemMetrics(SM_XVIRTUALSCREEN);
    int top = GetSystemMetrics(SM_YVIRTUALSCREEN);
    int width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
    int height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
    int nx = (int)Math.Round(((double)(x - left) * 65535.0) / Math.Max(1, width - 1));
    int ny = (int)Math.Round(((double)(y - top) * 65535.0) / Math.Max(1, height - 1));
    INPUT[] input = new INPUT[1];
    input[0].type = INPUT_MOUSE;
    input[0].U.mi.dx = nx;
    input[0].U.mi.dy = ny;
    input[0].U.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
    SendInput(1, input, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void Mouse(uint flags, int data) {
    INPUT[] input = new INPUT[1];
    input[0].type = INPUT_MOUSE;
    input[0].U.mi.mouseData = data;
    input[0].U.mi.dwFlags = flags;
    SendInput(1, input, Marshal.SizeOf(typeof(INPUT)));
  }
}
'@
${move}
${wheelStep}
${buttonSteps}
`;
}

function sendKeysValue(key: string) {
  const trimmed = key.trim();
  const commands: Record<string, string> = {
    TAB: '{TAB}',
    ENTER: '{ENTER}',
    ESC: '{ESC}',
    BACKSPACE: '{BACKSPACE}',
    DELETE: '{DELETE}',
    UP: '{UP}',
    DOWN: '{DOWN}',
    LEFT: '{LEFT}',
    RIGHT: '{RIGHT}',
    'CTRL+C': '^c',
    'CTRL+V': '^v',
    'CTRL+X': '^x',
    'CTRL+A': '^a',
    'ALT+TAB': '%{TAB}',
    'WIN+TAB': '^{ESC}'
  };
  return commands[trimmed.toUpperCase()] ?? trimmed;
}
