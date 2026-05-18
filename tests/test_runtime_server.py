#!/usr/bin/env python3
import contextlib
import http.client
import importlib.machinery
import json
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
amorist = importlib.machinery.SourceFileLoader("amorist_bin", str(ROOT / "bin" / "amorist")).load_module()


@contextlib.contextmanager
def run_server(markdown_path: Path):
    token = "test-token"
    state = amorist.ServerState(markdown_path=markdown_path, token=token)
    server = ThreadingHTTPServer(("127.0.0.1", 0), amorist.make_handler(state))
    server.daemon_threads = True
    state.server = server
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    try:
        yield f"http://{host}:{port}", token
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def request(url: str, data: bytes | None = None, method: str | None = None):
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def api_document(base_url: str, token: str) -> str:
    return f"{base_url}/api/document?token={urllib.parse.quote(token)}"


def save_payload(markdown: str, line_ending: str) -> bytes:
    return json.dumps({"markdown": markdown, "lineEnding": line_ending}).encode("utf-8")


def post_with_content_length(url: str, content_length: int) -> int:
    parsed = urllib.parse.urlparse(url)
    connection = http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=5)
    try:
        connection.putrequest("POST", f"{parsed.path}?{parsed.query}")
        connection.putheader("Content-Type", "application/json")
        connection.putheader("Content-Length", str(content_length))
        connection.endheaders()
        return connection.getresponse().status
    finally:
        connection.close()


def test_lf_save():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "notes.md"
        path.write_bytes(b"one\ntwo\n")
        with run_server(path) as (base_url, token):
            status, _body = request(api_document(base_url, token), save_payload("alpha\nbeta\n", "lf"), "POST")
            assert status == 200
        assert path.read_bytes() == b"alpha\nbeta\n"


def test_crlf_save():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "notes.md"
        path.write_bytes(b"one\r\ntwo\r\n")
        with run_server(path) as (base_url, token):
            status, _body = request(api_document(base_url, token), save_payload("alpha\nbeta\n", "crlf"), "POST")
            assert status == 200
        assert path.read_bytes() == b"alpha\r\nbeta\r\n"


def test_invalid_json_save_returns_400():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "notes.md"
        with run_server(path) as (base_url, token):
            status, _body = request(api_document(base_url, token), b"{", "POST")
        assert status == 400


def test_large_save_returns_413():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "notes.md"
        with run_server(path) as (base_url, token):
            status = post_with_content_length(api_document(base_url, token), amorist.MAX_MARKDOWN_BYTES + 1)
        assert status == 413


def test_invalid_utf8_read_returns_415_and_preserves_file():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "notes.md"
        original = b"valid\n\xff\n"
        path.write_bytes(original)
        with run_server(path) as (base_url, token):
            status, _body = request(api_document(base_url, token))
        assert status == 415
        assert path.read_bytes() == original


def run_tests():
    tests = [
        test_lf_save,
        test_crlf_save,
        test_invalid_json_save_returns_400,
        test_large_save_returns_413,
        test_invalid_utf8_read_returns_415_and_preserves_file,
    ]
    for test in tests:
        test()
    print("test_runtime_server.py passed")


if __name__ == "__main__":
    run_tests()
