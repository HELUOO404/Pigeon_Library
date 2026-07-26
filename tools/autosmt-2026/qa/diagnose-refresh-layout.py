"""Diagnostic probe for refresh cost and internal-main blank space."""

from __future__ import annotations

import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "tools" / "autosmt-2026" / "qa"
URL = "http://127.0.0.1:5173/learn.html?course=autosmt-oxidation-golden"


def metrics(page, label: str) -> dict:
    return page.evaluate(
        """label => {
          const main = document.querySelector('.main');
          const cards = [...document.querySelectorAll('.knowledge-card')].map(card => {
            const body = card.querySelector('.card-body');
            const rect = card.getBoundingClientRect();
            return {id: card.id, expanded: !body?.classList.contains('hidden'), top: rect.top, bottom: rect.bottom, height: rect.height};
          });
          const iframes = [...document.querySelectorAll('iframe.sandbox-frame')].map(frame => {
            const rect = frame.getBoundingClientRect();
            return {height: rect.height, top: rect.top, display: getComputedStyle(frame).display, parentHidden: Boolean(frame.closest('[hidden],.hidden'))};
          });
          const nav = performance.getEntriesByType('navigation')[0];
          const resources = performance.getEntriesByType('resource');
          return {
            label,
            innerWidth: innerWidth,
            innerHeight: innerHeight,
            documentHeight: document.documentElement.scrollHeight,
            bodyHeight: document.body.scrollHeight,
            mainClientHeight: main?.clientHeight ?? null,
            mainScrollHeight: main?.scrollHeight ?? null,
            mainScrollTop: main?.scrollTop ?? null,
            mainRect: main ? (() => { const r = main.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,height:r.height}; })() : null,
            cards,
            iframes,
            nodeCount: document.querySelectorAll('*').length,
            resourceCount: resources.length,
            resourceTransfer: resources.reduce((sum, item) => sum + (item.transferSize || 0), 0),
            domContentLoaded: nav?.domContentLoadedEventEnd ?? null,
            loadEvent: nav?.loadEventEnd ?? null,
          };
        }""",
        label,
    )


def executable() -> str | None:
    candidates = [
        os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ]
    return next((path for path in candidates if path and Path(path).is_file()), None)


def wait_ready(page) -> None:
    page.wait_for_selector('.card-header[data-kp-id="1-2-1"]', state="visible", timeout=30_000)
    try:
        page.wait_for_load_state("networkidle", timeout=30_000)
    except Exception:
        pass
    page.wait_for_timeout(1200)


def expand(page, card_id: str) -> None:
    header = page.locator(f'.card-header[data-kp-id="{card_id}"]')
    body = page.locator(f"#kp-{card_id} .card-body")
    if "hidden" in (body.get_attribute("class") or ""):
        header.click()
    body.wait_for(state="visible")


def run() -> None:
    launch = {"headless": True}
    if executable():
        launch["executable_path"] = executable()
    output = {}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**launch)
        context = browser.new_context(viewport={"width": 1377, "height": 812}, device_scale_factor=1)
        page = context.new_page()
        console_errors = []
        page_errors = []
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: page_errors.append(str(error)))

        page.goto(URL, wait_until="domcontentloaded", timeout=60_000)
        wait_ready(page)
        output["fresh"] = metrics(page, "fresh")
        page.screenshot(path=str(OUT / "refresh-diagnose-fresh.png"), full_page=False)

        # Reproduce a user session with more than one card open, then reload.
        expand(page, "1-2-1")
        expand(page, "1-2-4")
        page.locator(".main").evaluate("node => node.scrollTop = node.scrollHeight")
        page.wait_for_timeout(300)
        output["beforeReload"] = metrics(page, "beforeReload")
        page.screenshot(path=str(OUT / "refresh-diagnose-before-reload.png"), full_page=False)

        page.reload(wait_until="domcontentloaded", timeout=60_000)
        wait_ready(page)
        output["afterReload"] = metrics(page, "afterReload")
        page.screenshot(path=str(OUT / "refresh-diagnose-after-reload.png"), full_page=False)

        main = page.locator(".main")
        main.evaluate("node => node.scrollTop = node.scrollHeight")
        page.wait_for_timeout(300)
        output["afterScrollBottom"] = metrics(page, "afterScrollBottom")
        page.screenshot(path=str(OUT / "refresh-diagnose-after-scroll.png"), full_page=False)
        output["consoleErrors"] = console_errors
        output["pageErrors"] = page_errors
        context.close()
        browser.close()

    (OUT / "refresh-diagnose.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    run()
