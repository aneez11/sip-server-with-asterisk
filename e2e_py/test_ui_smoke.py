"""Self-contained UI smoke test for the redesigned console.

Serves the production build (web/dist) over a local HTTP server and mocks the API
with Playwright routes, so no backend/Asterisk is required.

Usage:
    npm run build -w web
    py e2e_py/test_ui_smoke.py
"""

import functools
import json
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "web" / "dist"

ENDPOINTS = [
    {"id": 1, "extension": "2001", "label": "Principal Office", "location": "Admin Block", "type": "phone", "isActive": True, "registered": True, "contactIp": "192.168.1.21", "userAgent": "Grandstream", "sipPassword": "pwd1"},
    {"id": 2, "extension": "3001", "label": "Corridor Speaker", "location": "First Floor", "type": "speaker", "isActive": True, "registered": False, "contactIp": None, "userAgent": None, "sipPassword": "pwd2"},
]
ZONES = [
    {"id": 1, "name": "All Staff", "beep": True, "volume": None, "announcementId": None, "autoAnswerProfileId": None, "endpointCount": 2, "endpointIds": [1, 2]},
    {"id": 2, "name": "Classrooms", "beep": True, "volume": None, "announcementId": None, "autoAnswerProfileId": None, "endpointCount": 1, "endpointIds": [1]},
]
OVERVIEW = {
    "endpoints": ENDPOINTS,
    "zones": ZONES,
    "recentLogs": [],
    "announcements": [],
    "music": [{"id": 1, "name": "Morning instrumental", "filename": "m1.wav", "originalName": "morning.wav", "fileSize": 3200000, "duration": 100}],
    "profiles": [],
    "busyZoneIds": [],
    "amiConnected": True,
    "serverTime": "2026-11-13T13:50:00Z",
}


def serve() -> tuple[ThreadingHTTPServer, str]:
    handler = functools.partial(SimpleHTTPRequestHandler, directory=str(DIST))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


def fulfil(route, data, status=200):
    route.fulfill(status=status, content_type="application/json", body=json.dumps(data))


def main() -> int:
    if not (DIST / "index.html").exists():
        print(f"Missing build at {DIST}. Run: npm run build -w web")
        return 2

    server, base = serve()
    passed = 0
    failed = 0

    def check(name: str, ok: bool, detail: str = "") -> None:
        nonlocal passed, failed
        if ok:
            passed += 1
            print(f"PASS {name}")
        else:
            failed += 1
            print(f"FAIL {name} {detail}".rstrip())

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            page.route("**/api/auth/me", lambda r: fulfil(r, {"ok": True, "userId": 1}))
            page.route("**/api/status/overview", lambda r: fulfil(r, OVERVIEW))
            page.route("**/api/pa-groups", lambda r: fulfil(r, []))
            page.route("**/api/monitor", lambda r: fulfil(r, {"active": [], "serverTime": "2026-11-13T13:50:00Z"}))
            page.route("**/api/endpoints/*/camera", lambda r: fulfil(r, {"enabled": False, "configured": False}))
            page.route("**/socket.io/**", lambda r: r.abort())

            page.goto(base + "/")
            page.wait_for_selector(".shell", timeout=15000)
            page.wait_for_timeout(1200)

            # 1. Broadcast target filtering.
            page.get_by_placeholder("Filter endpoints, zones or PA groups").fill("speaker")
            page.wait_for_timeout(250)
            tiles = page.locator(".target-tile")
            check("filter narrows targets", tiles.count() == 1, f"{tiles.count()} tiles")
            check("filter matches speaker", "Corridor Speaker" in tiles.first.inner_text())

            page.get_by_placeholder("Filter endpoints, zones or PA groups").fill("")
            page.wait_for_timeout(250)
            check("clearing filter restores targets", tiles.count() == 4, f"{tiles.count()} tiles")

            # 2. Music zone selection is store-backed and survives a tab switch.
            page.get_by_title("Music", exact=True).click()
            page.wait_for_timeout(300)
            page.locator(".zone-option").filter(has_text="All Staff").click()
            page.wait_for_timeout(300)
            page.get_by_title("Broadcast", exact=True).click()
            page.wait_for_timeout(300)

            row = page.locator(".context-foot .meta-row").filter(has_text="Music zones")
            check("music zones persist across tabs", row.inner_text().strip().endswith("1"), row.inner_text().strip())

            # 3. Saved theme is applied from the pre-paint script on reload.
            page.evaluate("localStorage.setItem('infinity-echo-theme', 'dark')")
            page.reload()
            page.wait_for_selector(".shell", timeout=15000)
            check(
                "saved theme applied on load",
                page.evaluate("document.documentElement.dataset.theme") == "dark",
            )

            browser.close()
    finally:
        server.shutdown()

    print("-" * 50)
    print(f"RESULT: {passed} passed, {failed} failed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
