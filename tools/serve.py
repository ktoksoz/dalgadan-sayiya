"""Geliştirme sunucusu: önbelleği kapatır, böylece her yenilemede en güncel dosyalar gelir.
Kullanım: python3 tools/serve.py [port]"""
import http.server, sys, os

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
http.server.ThreadingHTTPServer(("", port), NoCache).serve_forever()
