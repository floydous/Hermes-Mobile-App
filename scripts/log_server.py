import http.server
import sys
from datetime import datetime

PORT = 8765
LOG_FILE = "android-debug.log"

class LogHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length).decode('utf-8', errors='replace')
            timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
            log_entry = f"[{timestamp}] {post_data}\n"
            
            with open(LOG_FILE, "a", encoding="utf-8") as f:
                f.write(log_entry)
            sys.stdout.write(log_entry)
            sys.stdout.flush()
            
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Type', 'text/plain')
            self.send_header('Content-Length', '2')
            self.end_headers()
            self.wfile.write(b"OK")
        except Exception as e:
            sys.stderr.write(f"Handler error: {e}\n")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def log_message(self, format, *args):
        pass

if __name__ == "__main__":
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(f"\n--- Log server started at {datetime.now()} ---\n")
    print(f"Starting Hermes Remote Debug Log Server on 0.0.0.0:{PORT} -> {LOG_FILE}")
    server = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), LogHandler)
    server.serve_forever()
