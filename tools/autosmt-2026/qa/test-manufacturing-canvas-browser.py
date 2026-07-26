"""Browser QA for the five non-golden manufacturing drawing sandboxes."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[3]
QA_DIR = ROOT / "tools" / "autosmt-2026" / "qa"
URL = os.environ.get(
    "PIGEON_QA_URL",
    "http://127.0.0.1:5180/learn.html?course=2026-ic-manufacturing",
)
VIEWPORTS = [
    (1377, 812, "desktop"),
    (2048, 1216, "wide"),
    (375, 812, "mobile"),
]
DRAWINGS = [
    {
        "id": "drawing-3-2",
        "kp": "1-3-4",
        "answers": ["300", "10", "300", "10"],
        "alternatives": ["850", "20", "850", "20"],
        "source_initial_canvas": False,
    },
    {
        "id": "drawing-15-1",
        "kp": "1-8-3",
        "answers": ["950", "5", "1180", "1180", "30"],
        "alternatives": ["800", "10", "1050", "1050", "10"],
        "source_initial_canvas": False,
    },
    {
        "id": "drawing-15-2",
        "kp": "1-8-3",
        "answers": ["950", "10", "1050", "1050", "10"],
        "alternatives": ["800", "20", "1180", "1180", "30"],
        "source_initial_canvas": False,
    },
    {
        "id": "drawing-19-1",
        "kp": "1-9-6",
        "answers": ["0.15", "0.2", "0.21", "1.9", "2", "2.02", "3.9", "4", "4.02"],
        "alternatives": ["0.21", "2", "4", "0.15", "1.9", "3.9", "0.2", "2.02", "4.02"],
        "source_initial_canvas": True,
    },
    {
        "id": "drawing-19-2",
        "kp": "1-9-6",
        "answers": ["0.15", "0.2", "0.21", "0.8", "1", "1.02", "1.5", "4", "4.02"],
        "alternatives": ["0.21", "1", "4", "0.15", "0.8", "1.5", "0.2", "1.02", "4.02"],
        "source_initial_canvas": True,
    },
]

PLATFORM_FONT_HOSTS = {"fonts.googleapis.com", "fonts.gstatic.com"}


def local_chromium() -> str | None:
    for candidate in [
        os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ]:
        if candidate and Path(candidate).is_file():
            return candidate
    return None


def request_record(request) -> dict:
    try:
        frame_url = request.frame.url
    except Exception:
        frame_url = None
    return {
        "url": request.url,
        "frameUrl": frame_url,
        "resourceType": request.resource_type,
    }


def is_local_request(record: dict, origin) -> bool:
    parsed = urlparse(record["url"])
    if parsed.scheme in {"blob", "data", "about"}:
        return True
    return (
        parsed.scheme == origin.scheme
        and parsed.netloc == origin.netloc
    ) or (
        parsed.scheme == "http"
        and parsed.netloc == "localhost:8787"
    )


def is_platform_font_request(record: dict, origin) -> bool:
    target = urlparse(record["url"])
    frame = urlparse(record.get("frameUrl") or "")
    return (
        target.scheme == "https"
        and target.hostname in PLATFORM_FONT_HOSTS
        and frame.scheme == origin.scheme
        and frame.netloc == origin.netloc
    )


def install_mock_sync(context, requests: list[dict]) -> None:
    def handle(route, request) -> None:
        parsed = urlparse(request.url)
        endpoint = parsed.path.removeprefix("/api")
        origin = request.headers.get("origin", "http://127.0.0.1:5180")
        headers = {
            "access-control-allow-origin": origin,
            "access-control-allow-credentials": "true",
            "access-control-allow-headers": "content-type",
            "access-control-allow-methods": "GET,PUT,POST,OPTIONS",
            "content-type": "application/json; charset=utf-8",
        }
        requests.append({"method": request.method, "endpoint": endpoint})
        if request.method == "OPTIONS":
            route.fulfill(status=204, headers=headers, body="")
        elif request.method == "GET" and endpoint == "/me":
            route.fulfill(
                status=200,
                headers=headers,
                body=json.dumps({"user": {"id": "qa-user", "username": "qa-user", "role": "user"}}),
            )
        elif request.method == "GET" and endpoint == "/sync":
            route.fulfill(status=200, headers=headers, body=json.dumps({"states": []}))
        elif request.method == "PUT" and endpoint.startswith("/state/"):
            route.fulfill(
                status=200,
                headers=headers,
                body=json.dumps({"applied": True, "updated_at": 4102444800000}),
            )
        else:
            route.fulfill(status=404, headers=headers, body=json.dumps({"error": "unexpected QA API call"}))

    context.route("http://localhost:8787/api/**", handle)


def wait_for_course(page) -> None:
    page.goto(URL, wait_until="domcontentloaded", timeout=120_000)
    try:
        page.wait_for_load_state("networkidle", timeout=15_000)
    except PlaywrightTimeoutError:
        pass
    page.locator('.card-header[data-kp-id="1-3-4"]').wait_for(state="visible", timeout=60_000)
    title = page.locator("#courseLogo").text_content() or ""
    if "IC制造" not in title:
        raise AssertionError(f"manufacturing course did not load: {title!r}")


def open_card(page, knowledge_point: str) -> None:
    header = page.locator(f'.card-header[data-kp-id="{knowledge_point}"]')
    body = page.locator(f"#kp-{knowledge_point} .card-body")
    header.wait_for(state="visible")
    if "hidden" in (body.get_attribute("class") or ""):
        header.click()
        page.wait_for_timeout(420)
    body.wait_for(state="visible")


def open_drawing(page, drawing: dict):
    open_card(page, drawing["kp"])
    wrapper = page.locator(
        f'#kp-{drawing["kp"]} [data-sandbox-key="sandbox:{drawing["id"]}"]'
    )
    panel = wrapper.locator("xpath=ancestor::*[contains(@class,'tab-set-panel')]").first
    panel_id = panel.get_attribute("id")
    if not panel_id:
        raise AssertionError(f'{drawing["id"]}: tab panel id is missing')
    page.locator(f'#kp-{drawing["kp"]} [role="tab"][aria-controls="{panel_id}"]').click()
    wrapper.scroll_into_view_if_needed()
    frame = wrapper.frame_locator("iframe.sandbox-frame")
    frame.locator("[data-drawing-simulation]").wait_for(state="visible", timeout=30_000)
    return wrapper, frame


def canvas_pixels(frame) -> int:
    return frame.locator("canvas").evaluate(
        """canvas => {
          const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          let count = 0;
          for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) count += 1;
          return count;
        }"""
    )


def canvas_digest(frame) -> str:
    return hashlib.sha256(frame.locator("canvas").screenshot()).hexdigest()


def assert_layout(page, frame, drawing_id: str) -> dict:
    page_metrics = page.evaluate(
        """() => ({
          innerWidth: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
        })"""
    )
    if page_metrics["documentWidth"] > page_metrics["innerWidth"] + 1:
        raise AssertionError(f"{drawing_id}: document horizontal overflow {page_metrics}")
    if page_metrics["bodyWidth"] > page_metrics["innerWidth"] + 1:
        raise AssertionError(f"{drawing_id}: body horizontal overflow {page_metrics}")
    frame_metrics = frame.locator("html").evaluate(
        """html => {
          const body = document.body;
          const root = document.querySelector('[data-drawing-simulation]');
          const table = document.querySelector('table');
          const canvas = document.querySelector('canvas');
          return {
            htmlScrollWidth: html.scrollWidth,
            htmlClientWidth: html.clientWidth,
            bodyScrollWidth: body.scrollWidth,
            bodyClientWidth: body.clientWidth,
            htmlScrollHeight: html.scrollHeight,
            htmlClientHeight: html.clientHeight,
            htmlOverflow: getComputedStyle(html).overflow,
            bodyOverflow: getComputedStyle(body).overflow,
            rootWidth: root.getBoundingClientRect().width,
            tableRight: table.getBoundingClientRect().right,
            rootRight: root.getBoundingClientRect().right,
            canvasRight: canvas.getBoundingClientRect().right,
          };
        }"""
    )
    if frame_metrics["htmlScrollWidth"] > frame_metrics["htmlClientWidth"] + 1:
        raise AssertionError(f"{drawing_id}: iframe html horizontal overflow {frame_metrics}")
    if frame_metrics["bodyScrollWidth"] > frame_metrics["bodyClientWidth"] + 1:
        raise AssertionError(f"{drawing_id}: iframe body horizontal overflow {frame_metrics}")
    if frame_metrics["tableRight"] > frame_metrics["rootRight"] + 1:
        raise AssertionError(f"{drawing_id}: source table escaped sandbox {frame_metrics}")
    if frame_metrics["canvasRight"] > frame_metrics["rootRight"] + 1:
        raise AssertionError(f"{drawing_id}: canvas escaped sandbox {frame_metrics}")
    if frame_metrics["htmlOverflow"] != "hidden" or frame_metrics["bodyOverflow"] != "hidden":
        raise AssertionError(f"{drawing_id}: sandbox owns an internal scroller {frame_metrics}")
    return {"page": page_metrics, "frame": frame_metrics}


def exercise_drawing(page, drawing: dict, persist: bool) -> dict:
    wrapper, frame = open_drawing(page, drawing)
    selects = frame.locator("select")
    if selects.count() != len(drawing["answers"]):
        raise AssertionError(f'{drawing["id"]}: select count {selects.count()}')
    initial_values = [selects.nth(index).input_value() for index in range(selects.count())]
    if initial_values != [""] * len(drawing["answers"]):
        raise AssertionError(f'{drawing["id"]}: initial answers are not empty: {initial_values}')
    initial_pixels = canvas_pixels(frame)
    if drawing["source_initial_canvas"] and initial_pixels == 0:
        raise AssertionError(f'{drawing["id"]}: source load-time baseline curve is missing')
    if not drawing["source_initial_canvas"] and initial_pixels != 0:
        raise AssertionError(f'{drawing["id"]}: process canvas must start blank')
    layout = assert_layout(page, frame, drawing["id"])

    practice = wrapper.locator('[data-action="switch-sandbox-mode"][data-mode="practice"]')
    answer = wrapper.locator('[data-action="switch-sandbox-mode"][data-mode="answer"]')
    answer.click()
    page.wait_for_timeout(100)
    answer_values = [selects.nth(index).input_value() for index in range(selects.count())]
    if answer_values != drawing["answers"] or any(not selects.nth(index).is_disabled() for index in range(selects.count())):
        raise AssertionError(f'{drawing["id"]}: reference answer mismatch {answer_values}')
    if canvas_pixels(frame) == 0:
        raise AssertionError(f'{drawing["id"]}: answer mode rendered an empty canvas')

    practice.click()
    page.wait_for_timeout(80)
    if [selects.nth(index).input_value() for index in range(selects.count())] != [""] * len(drawing["answers"]):
        raise AssertionError(f'{drawing["id"]}: practice values were not restored')
    if canvas_pixels(frame) != 0:
        raise AssertionError(f'{drawing["id"]}: returning to practice did not clear the canvas')

    for index, value in enumerate(drawing["answers"]):
        selects.nth(index).select_option(value)
    frame.locator("[data-drawing-draw]").click()
    page.wait_for_timeout(100)
    correct_digest = canvas_digest(frame)
    score = wrapper.locator(".sandbox-score-chip")
    score.wait_for(state="visible")
    if f'正确率 {len(drawing["answers"])}/{len(drawing["answers"])}' not in (score.text_content() or ""):
        raise AssertionError(f'{drawing["id"]}: correct score chip mismatch {score.text_content()}')

    for index, value in enumerate(drawing["alternatives"]):
        selects.nth(index).select_option(value)
    frame.locator("[data-drawing-draw]").click()
    page.wait_for_timeout(100)
    alternative_digest = canvas_digest(frame)
    if alternative_digest == correct_digest:
        raise AssertionError(f'{drawing["id"]}: alternative inputs produced identical canvas output')

    persistence = None
    if persist:
        page.wait_for_timeout(1_500)
        page.reload(wait_until="domcontentloaded", timeout=120_000)
        try:
            page.wait_for_load_state("networkidle", timeout=15_000)
        except PlaywrightTimeoutError:
            pass
        wrapper, frame = open_drawing(page, drawing)
        selects = frame.locator("select")
        restored = [selects.nth(index).input_value() for index in range(selects.count())]
        if restored != drawing["alternatives"]:
            raise AssertionError(f'{drawing["id"]}: refresh restore mismatch {restored}')
        if canvas_pixels(frame) == 0:
            raise AssertionError(f'{drawing["id"]}: restored controls did not redraw the canvas')
        wrapper.locator(".sandbox-score-chip").wait_for(state="visible")
        persistence = {"restored": restored, "redrawn": True}

    frame.locator("[data-drawing-clear]").click()
    page.wait_for_timeout(100)
    if [selects.nth(index).input_value() for index in range(selects.count())] != [""] * len(drawing["answers"]):
        raise AssertionError(f'{drawing["id"]}: clear did not reset every selector')
    if canvas_pixels(frame) != 0 or wrapper.locator(".sandbox-score-chip").count() != 0:
        raise AssertionError(f'{drawing["id"]}: clear did not reset canvas and score')
    return {
        "initialValues": initial_values,
        "initialPixels": initial_pixels,
        "correctDigest": correct_digest,
        "alternativeDigest": alternative_digest,
        "layout": layout,
        "persistence": persistence,
    }


def run() -> None:
    QA_DIR.mkdir(parents=True, exist_ok=True)
    report = {"url": URL, "viewports": {}, "screenshots": {}, "errors": {}}
    with sync_playwright() as playwright:
        launch = {"headless": True}
        executable = local_chromium()
        if executable:
            launch["executable_path"] = executable
        browser = playwright.chromium.launch(**launch)
        for width, height, name in VIEWPORTS:
            context = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=1)
            sync_requests: list[dict] = []
            install_mock_sync(context, sync_requests)
            page = context.new_page()
            console_errors: list[str] = []
            page_errors: list[str] = []
            failed_requests: list[dict] = []
            all_requests: list[dict] = []
            page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
            page.on("pageerror", lambda error: page_errors.append(str(error)))
            page.on(
                "requestfailed",
                lambda request: failed_requests.append(
                    {**request_record(request), "failure": request.failure}
                ),
            )
            page.on("request", lambda request: all_requests.append(request_record(request)))
            try:
                wait_for_course(page)
                results = {}
                for drawing in DRAWINGS:
                    results[drawing["id"]] = exercise_drawing(page, drawing, persist=name == "desktop")
                wrapper, _ = open_drawing(page, DRAWINGS[-1])
                wrapper.locator('[data-action="switch-sandbox-mode"][data-mode="answer"]').click()
                page.wait_for_timeout(120)
                screenshot = QA_DIR / f"manufacturing-canvas-{name}.png"
                page.screenshot(path=str(screenshot), full_page=False)
                report["screenshots"][name] = str(screenshot.relative_to(ROOT)).replace("\\", "/")
                origin = urlparse(URL)
                external = [record for record in all_requests if not is_local_request(record, origin)]
                platform_font_requests = [
                    record for record in external if is_platform_font_request(record, origin)
                ]
                course_or_sandbox_external = [
                    record for record in external if record not in platform_font_requests
                ]
                ignored_failures = [
                    record
                    for record in failed_requests
                    if "ERR_ABORTED" in (record.get("failure") or "")
                    and "/assets/media/" in record["url"]
                ]
                platform_font_failures = [
                    record
                    for record in failed_requests
                    if is_platform_font_request(record, origin)
                ]
                unexpected_failures = [
                    record
                    for record in failed_requests
                    if record not in ignored_failures and record not in platform_font_failures
                ]
                if console_errors or page_errors or unexpected_failures or course_or_sandbox_external:
                    raise AssertionError(
                        f"{name}: browser errors console={console_errors}, page={page_errors}, "
                        f"requests={unexpected_failures}, "
                        f"course_or_sandbox_external={course_or_sandbox_external}"
                    )
                report["viewports"][name] = results
                report["errors"][name] = {
                    "console": console_errors,
                    "page": page_errors,
                    "requestFailures": unexpected_failures,
                    "ignoredRequestFailures": ignored_failures,
                    "platformFontFailures": platform_font_failures,
                    "platformBaselineExternalRequests": platform_font_requests,
                    "courseOrSandboxExternalRequests": course_or_sandbox_external,
                    "syncRequests": sync_requests,
                }
            finally:
                context.close()
        browser.close()
    report_path = QA_DIR / "manufacturing-canvas-browser.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    run()
