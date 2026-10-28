using System;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace RemoteAssist
{
    public class HelperForm : Form
    {
        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [DllImport("user32.dll")]
        private static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll")]
        private static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, int dwExtraInfo);

        [DllImport("user32.dll")]
        private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

        private const uint MOUSEEVENTF_LEFTDOWN   = 0x0002;
        private const uint MOUSEEVENTF_LEFTUP     = 0x0004;
        private const uint MOUSEEVENTF_RIGHTDOWN  = 0x0008;
        private const uint MOUSEEVENTF_RIGHTUP    = 0x0010;
        private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        private const uint MOUSEEVENTF_MIDDLEUP   = 0x0040;
        private const uint MOUSEEVENTF_WHEEL      = 0x0800;

        private const uint KEYEVENTF_KEYUP = 0x0002;
        private const byte VK_RETURN = 0x0D;
        private const byte VK_BACK   = 0x08;
        private const byte VK_TAB    = 0x09;
        private const byte VK_ESCAPE = 0x1B;
        private const byte VK_SPACE  = 0x20;
        private const byte VK_LEFT   = 0x25;
        private const byte VK_UP     = 0x26;
        private const byte VK_RIGHT  = 0x27;
        private const byte VK_DOWN   = 0x28;
        private const byte VK_DELETE = 0x2E;

        private HttpListener listener;
        private Thread serverThread;
        private volatile bool isRunning = true;
        private volatile bool allowOsControl = true;

        private Label statusLabel;
        private CheckBox allowCheckBox;
        private Label logLabel;
        private Button stopButton;

        public HelperForm()
        {
            this.Text = "RemoteAssist — Mouse & Keyboard Permission";
            this.Size = new Size(430, 300);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedSingle;
            this.MaximizeBox = false;
            this.BackColor = Color.FromArgb(19, 27, 46);
            this.ForeColor = Color.White;
            this.Font = new Font("Segoe UI", 10F, FontStyle.Regular);

            Label titleLabel = new Label();
            titleLabel.Text = "🛡️ RemoteAssist Mouse & Keyboard Helper (v2)";
            titleLabel.Font = new Font("Segoe UI", 12F, FontStyle.Bold);
            titleLabel.Location = new Point(20, 18);
            titleLabel.Size = new Size(385, 28);
            this.Controls.Add(titleLabel);

            statusLabel = new Label();
            statusLabel.Text = "🟢 Active — Partner can click, open files & type";
            statusLabel.ForeColor = Color.FromArgb(52, 211, 153);
            statusLabel.Location = new Point(20, 50);
            statusLabel.Size = new Size(385, 24);
            this.Controls.Add(statusLabel);

            allowCheckBox = new CheckBox();
            allowCheckBox.Text = "Allow my partner to control my mouse && keyboard";
            allowCheckBox.Checked = true;
            allowCheckBox.Font = new Font("Segoe UI", 10F, FontStyle.Bold);
            allowCheckBox.Location = new Point(22, 85);
            allowCheckBox.Size = new Size(380, 30);
            allowCheckBox.CheckedChanged += (s, e) => {
                allowOsControl = allowCheckBox.Checked;
                UpdateStatusText();
            };
            this.Controls.Add(allowCheckBox);

            logLabel = new Label();
            logLabel.Text = "Supports single-click, double-click to open files/folders, drag-and-drop, right-click, scroll, and keyboard typing.";
            logLabel.ForeColor = Color.FromArgb(148, 163, 184);
            logLabel.Font = new Font("Segoe UI", 9F, FontStyle.Regular);
            logLabel.Location = new Point(20, 122);
            logLabel.Size = new Size(380, 48);
            this.Controls.Add(logLabel);

            stopButton = new Button();
            stopButton.Text = "🛑 STOP && CLOSE HELPER NOW";
            stopButton.Font = new Font("Segoe UI", 11F, FontStyle.Bold);
            stopButton.BackColor = Color.FromArgb(239, 68, 68);
            stopButton.ForeColor = Color.White;
            stopButton.FlatStyle = FlatStyle.Flat;
            stopButton.FlatAppearance.BorderSize = 0;
            stopButton.Location = new Point(20, 182);
            stopButton.Size = new Size(375, 48);
            stopButton.Cursor = Cursors.Hand;
            stopButton.Click += (s, e) => {
                this.Close();
            };
            this.Controls.Add(stopButton);

            this.FormClosing += (s, e) => {
                isRunning = false;
                try { if (listener != null && listener.IsListening) listener.Stop(); } catch { }
            };

            StartLocalServer();
        }

        private void UpdateStatusText()
        {
            if (this.InvokeRequired)
            {
                this.BeginInvoke(new Action(UpdateStatusText));
                return;
            }
            if (!allowOsControl)
            {
                statusLabel.Text = "🔒 Paused — Mouse & Keyboard control is OFF";
                statusLabel.ForeColor = Color.FromArgb(251, 191, 36);
            }
            else
            {
                statusLabel.Text = "🟢 Active — Partner can click, open files & type";
                statusLabel.ForeColor = Color.FromArgb(52, 211, 153);
            }
        }

        private void StartLocalServer()
        {
            serverThread = new Thread(() => {
                try
                {
                    listener = new HttpListener();
                    listener.Prefixes.Add("http://127.0.0.1:3847/");
                    listener.Start();

                    while (isRunning && listener.IsListening)
                    {
                        HttpListenerContext ctx = listener.GetContext();
                        ThreadPool.QueueUserWorkItem((c) => HandleRequest((HttpListenerContext)c), ctx);
                    }
                }
                catch
                {
                }
            });
            serverThread.IsBackground = true;
            serverThread.Start();
        }

        private void HandleRequest(HttpListenerContext ctx)
        {
            try
            {
                HttpListenerRequest req = ctx.Request;
                HttpListenerResponse res = ctx.Response;

                res.Headers.Add("Access-Control-Allow-Origin", "*");
                res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
                res.Headers.Add("Access-Control-Allow-Headers", "Content-Type");
                res.Headers.Add("Access-Control-Allow-Private-Network", "true");

                if (req.HttpMethod == "OPTIONS")
                {
                    res.StatusCode = 204;
                    res.Close();
                    return;
                }

                Rectangle bounds = Screen.PrimaryScreen.Bounds;

                if (req.Url.AbsolutePath == "/status")
                {
                    string json = string.Format(
                        "{{\"ok\":true,\"version\":2,\"allowControl\":{0},\"width\":{1},\"height\":{2}}}",
                        allowOsControl ? "true" : "false",
                        bounds.Width,
                        bounds.Height
                    );
                    byte[] buf = Encoding.UTF8.GetBytes(json);
                    res.ContentType = "application/json";
                    res.ContentLength64 = buf.Length;
                    res.OutputStream.Write(buf, 0, buf.Length);
                    res.Close();
                    return;
                }

                if (req.Url.AbsolutePath == "/permission" && req.HttpMethod == "POST")
                {
                    byte[] buf = Encoding.UTF8.GetBytes("{\"ok\":true}");
                    res.ContentType = "application/json";
                    res.OutputStream.Write(buf, 0, buf.Length);
                    res.Close();
                    return;
                }

                if (req.Url.AbsolutePath == "/input" && req.HttpMethod == "POST")
                {
                    if (allowOsControl)
                    {
                        using (StreamReader reader = new StreamReader(req.InputStream, Encoding.UTF8))
                        {
                            string body = reader.ReadToEnd();
                            ExecuteInputCommand(body, bounds.Width, bounds.Height);
                        }
                    }
                    byte[] buf = Encoding.UTF8.GetBytes("{\"ok\":true}");
                    res.ContentType = "application/json";
                    res.OutputStream.Write(buf, 0, buf.Length);
                    res.Close();
                    return;
                }

                res.StatusCode = 404;
                res.Close();
            }
            catch
            {
                try { ctx.Response.Close(); } catch { }
            }
        }

        private void ExecuteInputCommand(string json, int screenW, int screenH)
        {
            string type = ExtractString(json, "type");
            double normX = ExtractDouble(json, "x");
            double normY = ExtractDouble(json, "y");

            int x = (int)Math.Round(Math.Max(0.0, Math.Min(1.0, normX)) * (screenW - 1));
            int y = (int)Math.Round(Math.Max(0.0, Math.Min(1.0, normY)) * (screenH - 1));
            string btn = ExtractString(json, "button");

            if (type == "pointer-move")
            {
                SetCursorPos(x, y);
            }
            else if (type == "mouse-down")
            {
                SetCursorPos(x, y);
                if (btn == "right")
                    mouse_event(MOUSEEVENTF_RIGHTDOWN, x, y, 0, 0);
                else if (btn == "middle")
                    mouse_event(MOUSEEVENTF_MIDDLEDOWN, x, y, 0, 0);
                else
                    mouse_event(MOUSEEVENTF_LEFTDOWN, x, y, 0, 0);
            }
            else if (type == "mouse-up")
            {
                SetCursorPos(x, y);
                if (btn == "right")
                    mouse_event(MOUSEEVENTF_RIGHTUP, x, y, 0, 0);
                else if (btn == "middle")
                    mouse_event(MOUSEEVENTF_MIDDLEUP, x, y, 0, 0);
                else
                    mouse_event(MOUSEEVENTF_LEFTUP, x, y, 0, 0);
            }
            else if (type == "mouse-click")
            {
                SetCursorPos(x, y);
                if (btn == "right")
                {
                    mouse_event(MOUSEEVENTF_RIGHTDOWN, x, y, 0, 0);
                    Thread.Sleep(15);
                    mouse_event(MOUSEEVENTF_RIGHTUP, x, y, 0, 0);
                }
                else
                {
                    mouse_event(MOUSEEVENTF_LEFTDOWN, x, y, 0, 0);
                    Thread.Sleep(15);
                    mouse_event(MOUSEEVENTF_LEFTUP, x, y, 0, 0);
                }
            }
            else if (type == "mouse-dblclick")
            {
                // Lock cursor at exact target pixel and fire fast native double-click to open files/folders
                SetCursorPos(x, y);
                mouse_event(MOUSEEVENTF_LEFTDOWN, x, y, 0, 0);
                mouse_event(MOUSEEVENTF_LEFTUP, x, y, 0, 0);
                Thread.Sleep(45);
                SetCursorPos(x, y);
                mouse_event(MOUSEEVENTF_LEFTDOWN, x, y, 0, 0);
                mouse_event(MOUSEEVENTF_LEFTUP, x, y, 0, 0);
            }
            else if (type == "mouse-scroll")
            {
                double deltaY = ExtractDouble(json, "deltaY");
                int wheel = (int)Math.Max(-360, Math.Min(360, -deltaY));
                mouse_event(MOUSEEVENTF_WHEEL, 0, 0, wheel, 0);
            }
            else if (type == "key-down")
            {
                string key = ExtractString(json, "key");
                SendKeyOnUiThread(key);
            }
            else if (type == "type-text")
            {
                string text = ExtractString(json, "text");
                if (!string.IsNullOrEmpty(text))
                {
                    this.BeginInvoke(new Action(() => {
                        try
                        {
                            foreach (char c in text)
                            {
                                string s = c.ToString();
                                if ("+^%~(){}[]".IndexOf(c) >= 0) s = "{" + c + "}";
                                SendKeys.SendWait(s);
                            }
                        }
                        catch { }
                    }));
                }
            }
        }

        private void TapVirtualKey(byte vk)
        {
            keybd_event(vk, 0, 0, 0);
            Thread.Sleep(10);
            keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
        }

        private void SendKeyOnUiThread(string key)
        {
            if (string.IsNullOrEmpty(key)) return;

            // Use direct Win32 keybd_event for navigation & Enter so opening files/folders always works
            switch (key)
            {
                case "Enter": TapVirtualKey(VK_RETURN); return;
                case "Backspace": TapVirtualKey(VK_BACK); return;
                case "Tab": TapVirtualKey(VK_TAB); return;
                case "Escape": TapVirtualKey(VK_ESCAPE); return;
                case " ": TapVirtualKey(VK_SPACE); return;
                case "ArrowLeft": TapVirtualKey(VK_LEFT); return;
                case "ArrowUp": TapVirtualKey(VK_UP); return;
                case "ArrowRight": TapVirtualKey(VK_RIGHT); return;
                case "ArrowDown": TapVirtualKey(VK_DOWN); return;
                case "Delete": TapVirtualKey(VK_DELETE); return;
            }

            string sendKey = MapSafeSendKey(key);
            if (!string.IsNullOrEmpty(sendKey))
            {
                this.BeginInvoke(new Action(() => {
                    try { SendKeys.SendWait(sendKey); } catch { }
                }));
            }
        }

        private string MapSafeSendKey(string key)
        {
            switch (key)
            {
                case "Home": return "{HOME}";
                case "End": return "{END}";
                case "PageUp": return "{PGUP}";
                case "PageDown": return "{PGDN}";
            }
            if (key.Length == 1)
            {
                char c = key[0];
                if ("+^%~(){}[]".IndexOf(c) >= 0)
                    return "{" + c + "}";
                return key;
            }
            return null;
        }

        private string ExtractString(string json, string field)
        {
            string pattern = "\"" + field + "\":\"";
            int idx = json.IndexOf(pattern);
            if (idx < 0) return "";
            idx += pattern.Length;
            int end = json.IndexOf("\"", idx);
            if (end < 0) return "";
            return json.Substring(idx, end - idx);
        }

        private double ExtractDouble(string json, string field)
        {
            string pattern = "\"" + field + "\":";
            int idx = json.IndexOf(pattern);
            if (idx < 0) return 0.0;
            idx += pattern.Length;
            int end = idx;
            while (end < json.Length && ("0123456789.-".IndexOf(json[end]) >= 0))
            {
                end++;
            }
            double val;
            if (double.TryParse(json.Substring(idx, end - idx), System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out val))
                return val;
            return 0.0;
        }

        [STAThread]
        public static void Main()
        {
            try { SetProcessDPIAware(); } catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new HelperForm());
        }
    }
}
