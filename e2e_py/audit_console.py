"""
Infinity Echo - console audit with Python Playwright.

Runs a full UI audit against the deployed console:
  login -> sidebar/zones -> endpoints (status, add, duplicate error, password copy)
  -> broadcast -> live talk -> history.

Usage:
  py e2e_py/audit_console.py [--base-url http://127.0.0.1:3001] [--headed]

Exit code 0 = all PASS, 1 = any FAIL. Screenshots on failure: e2e_py/_*.png
Conventions (per Infinity BIZ v2 methodology): sync API, ASCII-only output,
PASS/FAIL per step.
"""
import argparse
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

BASE = "http://127.0.0.1:3001"
SHOT_DIR = Path(__file__).parent

passed = 0
failed = 0


def report(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"PASS  {name}" + (f"  [{detail}]" if detail else ""))
    else:
        failed += 1
        print(f"FAIL  {name}" + (f"  [{detail}]" if detail else ""))


def shot(page, name):
    page.screenshot(path=str(SHOT_DIR / f"_{name}.png"))


def run(base_url: str, headed: bool):
    global passed, failed
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not headed)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.set_default_timeout(10000)

        # ---- 1. Login page -----------------------------------------------
        page.goto(base_url + "/")
        try:
            expect(page.get_by_text("Paging console").first).to_be_visible(timeout=8000)
            report("login page branding", True)
        except Exception as e:
            report("login page branding", False, str(e)[:120])
            shot(page, "01-login")
            browser.close()
            return 1

        page.get_by_placeholder("Username").fill("admin")
        page.get_by_placeholder("Password").fill("admin12345")
        page.get_by_role("button", name="Sign in").click()

        try:
            expect(page.get_by_role("tab", name="Broadcast")).to_be_visible(timeout=8000)
            report("login succeeds, console renders", True)
        except Exception as e:
            report("login succeeds, console renders", False, str(e)[:120])
            shot(page, "02-after-login")
            browser.close()
            return 1
        shot(page, "02-console")

        # ---- 2. Topbar status + sidebar -----------------------------------
        try:
            expect(page.get_by_text("Zones & endpoints")).to_be_visible()
            report("sidebar renders", True)
        except Exception as e:
            report("sidebar renders", False, str(e)[:120])

        topbar = page.locator("header").first
        topbar_text = topbar.inner_text()
        has_count = "registered" in topbar_text or "No endpoints" in topbar_text or "/" in topbar_text
        report("topbar shows endpoint count", has_count, topbar_text.strip().replace("\n", " ")[:80])

        # ---- 3. Endpoints tab (table UI) ----------------------------------
        page.get_by_role("tab", name="Endpoints").click()
        try:
            expect(page.get_by_role("button", name="Add endpoint")).to_be_visible(timeout=5000)
            report("endpoints page renders", True)
        except Exception as e:
            report("endpoints page renders", False, str(e)[:120])
            shot(page, "03-endpoints")
            browser.close()
            return 1

        table_ok = (
            page.get_by_role("columnheader", name="Extension").count() > 0
            and page.get_by_role("columnheader", name="IP").count() > 0
            and page.get_by_role("columnheader", name="SIP Password").count() > 0
            and page.get_by_role("columnheader", name="Active").count() > 0
        )
        report("endpoints rendered as table with IP column", table_ok)
        shot(page, "03-endpoints")

        # ---- 4. Create endpoint -> table row with password copy -----------
        page.get_by_role("button", name="Add endpoint").click()
        try:
            expect(page.get_by_role("heading", name="Add endpoint")).to_be_visible(timeout=5000)
            report("add-endpoint dialog opens", True)
        except Exception as e:
            report("add-endpoint dialog opens", False, str(e)[:120])

        page.get_by_placeholder("2001").fill("2005")
        page.get_by_placeholder("Office Phone").fill("Audit Test")
        page.get_by_role("button", name="Save").click()
        try:
            expect(page.get_by_role("heading", name="Add endpoint")).to_have_count(0, timeout=12000)
            report("endpoint create dialog closes on save", True)
        except Exception as e:
            report("endpoint create dialog closes on save", False, str(e)[:100])
            page.get_by_role("button", name="Cancel").click(timeout=3000)
            page.wait_for_timeout(500)

        row = page.locator("main").locator("tr", has_text="Audit Test")
        report("endpoint row created", row.count() > 0, "2005")
        report("password row with copy on table row", "SIP password:" in row.first.inner_text(), row.first.inner_text().replace("\n", " | ")[:110])

        # ---- 5. Duplicate extension -> clean JSON toast (dialog stays open)
        page.get_by_role("button", name="Add endpoint").click()
        page.get_by_placeholder("2001").fill("2005")
        page.get_by_placeholder("Office Phone").fill("Dup Test")
        page.get_by_role("button", name="Save").click()
        page.wait_for_timeout(1500)
        toasts = page.locator("[role=status], .go2072408551").all_inner_texts()
        toast_text = " ".join(toasts)
        has_dup_msg = "already exists" in toast_text.lower() or "exists" in toast_text.lower()
        has_html = "<!DOCTYPE" in toast_text or "<pre>" in toast_text
        report("duplicate extension -> clean toast", has_dup_msg and not has_html, toast_text[:100])
        # dialog should stay open on failure
        dialog_open = page.get_by_role("heading", name="Add endpoint").count() > 0
        report("dialog stays open on error", dialog_open)
        page.get_by_role("button", name="Cancel").click(timeout=3000)
        page.wait_for_timeout(500)

        # ---- 6. Delete the test endpoint ------------------------------------
        row.locator("button[title=Delete]").click()
        page.wait_for_timeout(1500)
        body_text = page.locator("main").inner_text()
        report("test endpoint deleted", "Audit Test" not in body_text)

        # ---- 6. Zones manager ----------------------------------------------
        page.get_by_role("tab", name="Zones").click()
        try:
            expect(page.get_by_role("button", name="Add zone")).to_be_visible(timeout=5000)
            report("zones page renders", True)
        except Exception as e:
            report("zones page renders", False, str(e)[:120])

        # zone created
        page.get_by_role("button", name="Add zone").click()
        page.get_by_role("textbox").fill("Audit Zone")
        page.get_by_role("button", name="Save").click()
        page.wait_for_timeout(1200)
        report("zone created", "Audit Zone" in page.locator("main").inner_text())
        shot(page, "04-zones")

        # ---- 7. Broadcast tab ----------------------------------------------
        page.get_by_role("tab", name="Broadcast").click()
        try:
            expect(page.get_by_role("button", name="Upload WAV")).to_be_visible(timeout=5000)
            report("broadcast page renders", True)
        except Exception as e:
            report("broadcast page renders", False, str(e)[:120])

        zone_btns = page.get_by_role("button", name="Audit Zone").count()
        report("zone quick-play button present", zone_btns > 0, f"{zone_btns} button(s)")
        shot(page, "05-broadcast")

        # cleanup: delete the audit zone
        page.get_by_role("tab", name="Zones").click()
        row = page.locator("main").get_by_text("Audit Zone").locator("xpath=ancestor::tr").first
        row.locator("button[title=Delete]").click()
        page.wait_for_timeout(1200)
        report("zone deleted", "Audit Zone" not in page.locator("main").inner_text())

        # ---- 8. Live talk tab ----------------------------------------------
        page.get_by_role("tab", name="Live talk").click()
        try:
            expect(page.get_by_role("button", name="Start talk")).to_be_visible(timeout=5000)
            report("live talk page renders", True)
        except Exception as e:
            report("live talk page renders", False, str(e)[:120])
        shot(page, "06-live-talk")

        # ---- 9. History tab ------------------------------------------------
        page.get_by_role("tab", name="History").click()
        try:
            expect(page.get_by_text("recent broadcast")).to_be_visible(timeout=5000)
            report("history page renders", True)
        except Exception as e:
            report("history page renders", False, str(e)[:120])
        shot(page, "07-history")

        browser.close()

    print("-" * 50)
    print(f"RESULT: {passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default=BASE)
    ap.add_argument("--headed", action="store_true", default=False)
    args = ap.parse_args()
    sys.exit(run(args.base_url, args.headed))
