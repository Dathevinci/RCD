/**
 * Prashnaa Local Host Agent (host-agent.js)
 * -----------------------------------------
 * Runs locally on the Host laptop (127.0.0.1:3847 ONLY) to bridge approved
 * WebRTC remote mouse/keyboard events from the Host's browser UI to the OS.
 *
 * Security & Consent Safeguards:
 * 1. Binds strictly to 127.0.0.1 (never reachable from external networks).
 * 2. Requires the Host user to explicitly enable "Allow OS Mouse & Keyboard Control"
 *    inside the Host browser dashboard.
 * 3. Press SPACE in this terminal at any time to immediately PAUSE/RESUME control,
 *    or Ctrl+C to stop the agent.
 */

const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const os = require('os');

const AGENT_PORT = 3847;
let agentPausedByTerminal = false;
let hostUiAllowControl = false;

// Persistent Windows Input Worker using PowerShell + C# P/Invoke (zero native npm build needed)
class WindowsInputWorker {
  constructor() {
    this.proc = null;
    this.ready = false;
    this.screenWidth = 1920;
    this.screenHeight = 1080;
    this.init();
  }

  init() {
    if (os.platform() !== 'win32') {
      console.log('⚠️  Non-Windows OS detected. OS input simulation will run in dry-run log mode.');
      return;
    }

    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Input {
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, int dwExtraInfo);

    public const uint MOUSEEVENTF_LEFTDOWN   = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP     = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN  = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP    = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP   = 0x0040;
    public const uint MOUSEEVENTF_WHEEL      = 0x0800;
}
"@

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
Write-Output ("SCREEN:" + $bounds.Width + "x" + $bounds.Height)

while ($null -ne ($line = [Console]::In.ReadLine())) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    try {
        $cmd = $line | ConvertFrom-Json
        switch ($cmd.action) {
            "move" {
                [Win32Input]::SetCursorPos([int]$cmd.x, [int]$cmd.y) | Out-Null
            }
            "mousedown" {
                [Win32Input]::SetCursorPos([int]$cmd.x, [int]$cmd.y) | Out-Null
                if ($cmd.button -eq "right") {
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0)
                } elseif ($cmd.button -eq "middle") {
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, 0)
                } else {
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
                }
            }
            "mouseup" {
                [Win32Input]::SetCursorPos([int]$cmd.x, [int]$cmd.y) | Out-Null
                if ($cmd.button -eq "right") {
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0)
                } elseif ($cmd.button -eq "middle") {
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_MIDDLEUP, 0, 0, 0, 0)
                } else {
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
                }
            }
            "click" {
                [Win32Input]::SetCursorPos([int]$cmd.x, [int]$cmd.y) | Out-Null
                if ($cmd.button -eq "right") {
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0)
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0)
                } else {
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
                }
            }
            "dblclick" {
                [Win32Input]::SetCursorPos([int]$cmd.x, [int]$cmd.y) | Out-Null
                [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
                [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
                Start-Sleep -Milliseconds 40
                [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
                [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
            }
            "scroll" {
                [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_WHEEL, 0, 0, [int]$cmd.delta, 0)
            }
            "key" {
                [System.Windows.Forms.SendKeys]::SendWait([string]$cmd.sendKey)
            }
        }
    } catch {
        # Ignore malformed single event
    }
}
`;

    this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.proc.stdout.on('data', (data) => {
      const text = data.toString().trim();
      const match = text.match(/SCREEN:(\d+)x(\d+)/);
      if (match) {
        this.screenWidth = parseInt(match[1], 10);
        this.screenHeight = parseInt(match[2], 10);
        this.ready = true;
        console.log(`✅ OS Input Worker ready — Primary Screen: ${this.screenWidth}x${this.screenHeight}`);
      }
    });

    this.proc.on('exit', () => {
      this.ready = false;
    });
  }

  send(payload) {
    if (!this.ready || !this.proc || !this.proc.stdin.writable) return;
    this.proc.stdin.write(JSON.stringify(payload) + '\n');
  }

  toScreenCoords(normX, normY) {
    const clampedX = Math.max(0, Math.min(1, Number(normX) || 0));
    const clampedY = Math.max(0, Math.min(1, Number(normY) || 0));
    return {
      x: Math.round(clampedX * (this.screenWidth - 1)),
      y: Math.round(clampedY * (this.screenHeight - 1))
    };
  }
}

// Safe mapping from browser KeyboardEvent.key to Windows SendKeys syntax
const SAFE_SPECIAL_KEYS = {
  Enter: '{ENTER}',
  Backspace: '{BACKSPACE}',
  Tab: '{TAB}',
  Escape: '{ESC}',
  ArrowUp: '{UP}',
  ArrowDown: '{DOWN}',
  ArrowLeft: '{LEFT}',
  ArrowRight: '{RIGHT}',
  Delete: '{DELETE}',
  Home: '{HOME}',
  End: '{END}',
  PageUp: '{PGUP}',
  PageDown: '{PGDN}',
  ' ': ' '
};

function sanitizeKeyForSendKeys(key) {
  if (!key || typeof key !== 'string') return null;
  if (SAFE_SPECIAL_KEYS[key]) {
    return SAFE_SPECIAL_KEYS[key];
  }
  // Single printable character
  if (key.length === 1) {
    // SendKeys special characters must be wrapped in braces
    if (['+', '^', '%', '~', '(', ')', '{', '}', '[', ']'].includes(key)) {
      return `{${key}}`;
    }
    return key;
  }
  return null;
}

const worker = new WindowsInputWorker();

const wss = new WebSocketServer({
  host: '127.0.0.1',
  port: AGENT_PORT
});

function broadcastAgentStatus() {
  const payload = JSON.stringify({
    type: 'agent-status',
    connected: true,
    pausedByTerminal: agentPausedByTerminal,
    allowControl: hostUiAllowControl && !agentPausedByTerminal,
    screen: {
      width: worker.screenWidth,
      height: worker.screenHeight
    }
  });
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

wss.on('connection', (ws, req) => {
  // Verify connection is coming from localhost
  const remoteAddress = req.socket.remoteAddress;
  if (remoteAddress !== '127.0.0.1' && remoteAddress !== '::1' && remoteAddress !== '::ffff:127.0.0.1') {
    ws.close();
    return;
  }

  console.log('🔗 Host Browser UI connected to Local Input Agent.');
  broadcastAgentStatus();

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'set-allow-control') {
        hostUiAllowControl = Boolean(msg.allowControl);
        console.log(
          hostUiAllowControl
            ? '🟢 Host ENABLED Remote OS Mouse & Keyboard Control.'
            : '🔒 Host DISABLED Remote OS Mouse & Keyboard Control (View-only mode).'
        );
        broadcastAgentStatus();
        return;
      }

      // Never execute OS inputs unless BOTH the Host UI toggle is ON and terminal hasn't paused it
      if (!hostUiAllowControl || agentPausedByTerminal) {
        return;
      }

      if (msg.type === 'input-event' && msg.event) {
        const ev = msg.event;
        const coords = worker.toScreenCoords(ev.x, ev.y);

        switch (ev.type) {
          case 'pointer-move':
            worker.send({ action: 'move', x: coords.x, y: coords.y });
            break;
          case 'mouse-down':
            worker.send({ action: 'mousedown', x: coords.x, y: coords.y, button: ev.button || 'left' });
            break;
          case 'mouse-up':
            worker.send({ action: 'mouseup', x: coords.x, y: coords.y, button: ev.button || 'left' });
            break;
          case 'mouse-click':
            worker.send({ action: 'click', x: coords.x, y: coords.y, button: ev.button || 'left' });
            break;
          case 'mouse-dblclick':
            worker.send({ action: 'dblclick', x: coords.x, y: coords.y });
            break;
          case 'mouse-scroll': {
            const delta = Math.max(-360, Math.min(360, Math.round(-(Number(ev.deltaY) || 0))));
            worker.send({ action: 'scroll', delta });
            break;
          }
          case 'key-down': {
            const sendKey = sanitizeKeyForSendKeys(ev.key);
            if (sendKey) {
              worker.send({ action: 'key', sendKey });
            }
            break;
          }
        }
      }
    } catch {
      // Ignore invalid JSON
    }
  });

  ws.on('close', () => {
    hostUiAllowControl = false;
    console.log('🔒 Host Browser UI disconnected — OS input control automatically locked.');
  });
});

// Terminal emergency pause toggle with SPACEBAR
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (chunk) => {
    const key = chunk.toString();
    if (key === '\u0003') {
      // Ctrl+C
      console.log('\n🛑 Stopping Prashnaa Local Host Agent...');
      process.exit(0);
    }
    if (key === ' ') {
      agentPausedByTerminal = !agentPausedByTerminal;
      console.log(
        agentPausedByTerminal
          ? '\n⏸️  [EMERGENCY PAUSE] OS Input Control PAUSED from terminal. Press SPACE to resume.'
          : '\n▶️  [RESUMED] OS Input Control resumed.'
      );
      broadcastAgentStatus();
    }
  });
}

console.log('\n============================================================');
console.log('  🖱️  Prashnaa — Local Host Input Agent');
console.log('============================================================');
console.log(`  Listening on: ws://127.0.0.1:${AGENT_PORT} (Localhost Only)`);
console.log('  Safety Controls:');
console.log('   • Press [SPACE] at any time to immediately PAUSE/RESUME input');
console.log('   • Press [Ctrl+C] to terminate the agent immediately');
console.log('============================================================\n');
