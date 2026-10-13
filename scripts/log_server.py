import http.server
import json
import os
import sys
from datetime import datetime
import argparse

DEFAULT_PORT = 8765
DEFAULT_HOST = "0.0.0.0"
LOG_FILE = "android-debug.log"
DEBUG_TOKEN = os.environ.get("HERMES_DEBUG_TOKEN", "")

def format_perf_record(record, timestamp):
    try:
        op = record.get("op", "unknown")
        phase = record.get("phase", "unknown")
        trace_id = record.get("traceId", "-")
        dur = record.get("durationMs", 0.0)
        metrics = record.get("metrics", {})
        metrics_str = " " + json.dumps(metrics, separators=(",", ":")) if metrics else ""
        return f"[{timestamp}] [PERF][{op}:{phase}] trace={trace_id} dur={dur:.2f}ms{metrics_str}\n"
    except Exception:
        return f"[{timestamp}] [PERF] {json.dumps(record)}\n"

class LogHandler(http.server.BaseHTTPRequestHandler):
    auth_token = DEBUG_TOKEN

    def is_authorized(self):
        if not self.auth_token:
            return True
        header_token = self.headers.get("X-Hermes-Debug-Token")
        if header_token and header_token == self.auth_token:
            return True
        auth_header = self.headers.get("Authorization", "")
        if auth_header.startswith("Bearer ") and auth_header[7:].strip() == self.auth_token:
            return True
        return False

    def do_POST(self):
        try:
            if not self.is_authorized():
                self.send_response(401)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(b"Unauthorized")
                self.wfile.flush()
                return

            content_length = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(content_length).decode("utf-8", errors="replace")
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]

            content_type = self.headers.get("Content-Type", "").lower()
            is_ndjson = "ndjson" in content_type or "json" in content_type or raw_body.strip().startswith("{") or raw_body.strip().startswith("[")

            entries_to_write = []

            if is_ndjson:
                lines = [l.strip() for l in raw_body.strip().split("\n") if l.strip()]
                for line in lines:
                    try:
                        parsed = json.loads(line)
                        if isinstance(parsed, list):
                            for item in parsed:
                                if isinstance(item, dict) and "op" in item:
                                    entries_to_write.append(format_perf_record(item, timestamp))
                                else:
                                    entries_to_write.append(f"[{timestamp}] {json.dumps(item)}\n")
                        elif isinstance(parsed, dict) and "op" in parsed:
                            entries_to_write.append(format_perf_record(parsed, timestamp))
                        else:
                            entries_to_write.append(f"[{timestamp}] {line}\n")
                    except Exception:
                        entries_to_write.append(f"[{timestamp}] {line}\n")
            else:
                entries_to_write.append(f"[{timestamp}] {raw_body}\n")

            log_output = "".join(entries_to_write)
            with open(LOG_FILE, "a", encoding="utf-8") as f:
                f.write(log_output)
            sys.stdout.write(log_output)
            sys.stdout.flush()

            response_body = b"OK"
            self.send_response(200)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(response_body)))
            self.end_headers()
            self.wfile.write(response_body)
            self.wfile.flush()
        except Exception as e:
            sys.stderr.write(f"Handler error: {e}\n")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Hermes-Debug-Token")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, format, *args):
        pass

def main():
    global LOG_FILE
    parser = argparse.ArgumentParser(description="Hermes Remote Debug & Performance Log Server")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", DEFAULT_PORT)), help="Port to listen on (default: 8765)")
    parser.add_argument("--host", default=os.environ.get("HOST", DEFAULT_HOST), help="Host interface to bind to (default: 0.0.0.0)")
    parser.add_argument("--token", default=DEBUG_TOKEN, help="Optional debug token for authentication")
    parser.add_argument("--log-file", default=LOG_FILE, help="Target log file (default: android-debug.log)")
    args = parser.parse_args()

    LOG_FILE = args.log_file
    LogHandler.auth_token = args.token

    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(f"\n--- Log server started at {datetime.now()} (bind {args.host}:{args.port}, auth={'enabled' if args.token else 'none'}) ---\n")
    print(f"Starting Hermes Remote Debug Log Server on {args.host}:{args.port} -> {LOG_FILE} (auth={'enabled' if args.token else 'none'})")
    server = http.server.ThreadingHTTPServer((args.host, args.port), LogHandler)
    server.serve_forever()

if __name__ == "__main__":
    main()
