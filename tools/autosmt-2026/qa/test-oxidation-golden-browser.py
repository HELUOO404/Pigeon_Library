"""Browser evidence for the isolated AutoSMT oxidation golden package.

The script is intentionally small and uses only selectors exposed by the
learning page.  The webapp-testing helper supplies the Vite server.
"""

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
    "http://127.0.0.1:5173/learn.html?course=autosmt-oxidation-golden",
)
VIEWPORTS = [
    (1377, 812, "desktop"),
    (2048, 1216, "wide"),
    (375, 812, "mobile"),
]
COURSE_DIR = ROOT / "courses" / "autosmt-previews" / "autosmt-oxidation-golden"
DEPLOYMENT_PACKAGE = (
    ROOT
    / "dist-courses"
    / "autosmt-previews"
    / "autosmt-oxidation-golden"
    / "autosmt-oxidation-golden.pigeon"
)
FULL_PACKAGE = (
    ROOT
    / "dist-courses"
    / "autosmt-previews"
    / "autosmt-oxidation-golden.full.pigeon"
)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_evidence(path: Path) -> dict:
    data = path.read_bytes()
    return {
        "path": str(path.relative_to(ROOT)).replace("\\", "/"),
        "bytes": len(data),
        "sha256": digest(data),
    }


def install_mock_sync(context, requests: list[dict]) -> None:
    """Expose a deterministic logged-in namespace without touching a real account."""

    def handle(route, request) -> None:
        parsed = urlparse(request.url)
        endpoint = parsed.path.removeprefix("/api")
        origin = request.headers.get("origin", "http://127.0.0.1:5173")
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


def local_chromium() -> str | None:
    candidates = [
        os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    return None


def layout_metrics(page) -> dict:
    return page.evaluate(
        """() => ({
          innerWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          innerHeight: window.innerHeight,
        })"""
    )


def assert_no_overflow(page, label: str) -> dict:
    metrics = layout_metrics(page)
    if metrics["documentWidth"] > metrics["innerWidth"] + 1:
        raise AssertionError(f"{label}: document overflow {metrics}")
    if metrics["bodyWidth"] > metrics["innerWidth"] + 1:
        raise AssertionError(f"{label}: body overflow {metrics}")
    return metrics


def check_initial_collapsed_state(page, viewport_name: str) -> None:
    expanded = page.locator(".knowledge-card .card-body:not(.hidden)")
    if expanded.count():
        raise AssertionError(f"{viewport_name}: refresh restored {expanded.count()} expanded cards")


def check_card_animation(page, viewport_name: str) -> None:
    header = page.locator('.card-header[data-kp-id="1-2-1"]')
    body = page.locator("#kp-1-2-1 .card-body")
    if body.evaluate("node => node.getBoundingClientRect().height") != 0:
        raise AssertionError(f"{viewport_name}: collapsed card starts with non-zero height")
    header.click()
    page.wait_for_timeout(60)
    opening_height = body.evaluate("node => node.getBoundingClientRect().height")
    page.wait_for_timeout(240)
    if "is-animating" not in (body.get_attribute("class") or ""):
        raise AssertionError(f"{viewport_name}: card animation still ends too quickly")
    page.wait_for_timeout(120)
    expanded_height = body.evaluate("node => node.getBoundingClientRect().height")
    if not 0 < opening_height < expanded_height or "hidden" in (body.get_attribute("class") or ""):
        raise AssertionError(
            f"{viewport_name}: card did not animate open: opening={opening_height}, expanded={expanded_height}"
        )
    header.click()
    page.wait_for_timeout(60)
    closing_height = body.evaluate("node => node.getBoundingClientRect().height")
    page.wait_for_timeout(360)
    collapsed_height = body.evaluate("node => node.getBoundingClientRect().height")
    if not 0 < closing_height < expanded_height or collapsed_height != 0 or "hidden" not in (body.get_attribute("class") or ""):
        raise AssertionError(
            f"{viewport_name}: card did not animate closed: closing={closing_height}, collapsed={collapsed_height}"
        )
    header.click()
    page.wait_for_timeout(40)
    header.click()
    page.wait_for_timeout(40)
    header.click()
    page.wait_for_timeout(420)
    rapid_class = body.get_attribute("class") or ""
    if "hidden" in rapid_class or "is-animating" in rapid_class or body.evaluate("node => node.getBoundingClientRect().height") <= 0:
        raise AssertionError(f"{viewport_name}: rapid card toggles did not settle expanded: {rapid_class}")
    header.click()
    page.wait_for_timeout(420)


def check_footer_layout(page, viewport_name: str) -> dict:
    metrics = page.evaluate(
        """async () => {
          const main = document.querySelector('.main');
          const app = document.querySelector('.app');
          const footer = document.querySelector('.app-footer');
          const sidebar = document.querySelector('.sidebar');
          const chapter = [...document.querySelectorAll('.chapter-content')]
            .find(node => getComputedStyle(node).display !== 'none');
          const last = chapter?.lastElementChild;
          main.scrollTop = main.scrollHeight;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const mainRect = main.getBoundingClientRect();
          const appRect = app.getBoundingClientRect();
          const footerRect = footer.getBoundingClientRect();
          const sidebarRect = sidebar.getBoundingClientRect();
          const lastRect = last?.getBoundingClientRect();
          return {
            innerHeight: window.innerHeight,
            documentHeight: document.documentElement.scrollHeight,
            bodyHeight: document.body.scrollHeight,
            mainBottom: mainRect.bottom,
            appBottom: appRect.bottom,
            sidebarBottom: sidebarRect.bottom,
            footerTop: footerRect.top,
            lastGap: lastRect ? footerRect.top - lastRect.bottom : null,
            mainPaddingBottom: parseFloat(getComputedStyle(main).paddingBottom),
            scrollTop: main.scrollTop,
            maxScrollTop: main.scrollHeight - main.clientHeight,
          };
        }"""
    )
    for edge in ("mainBottom", "appBottom", "sidebarBottom"):
        if abs(metrics[edge] - metrics["footerTop"]) > 1:
            raise AssertionError(f"{viewport_name}: {edge} does not meet footer: {metrics}")
    if metrics["mainPaddingBottom"] != 0:
        raise AssertionError(f"{viewport_name}: main still reserves duplicate footer padding: {metrics}")
    if metrics["lastGap"] is None or not -1 <= metrics["lastGap"] <= 17:
        raise AssertionError(f"{viewport_name}: bottom blank band remains: {metrics}")
    if abs(metrics["scrollTop"] - metrics["maxScrollTop"]) > 1:
        raise AssertionError(f"{viewport_name}: main did not reach its real bottom: {metrics}")
    if metrics["documentHeight"] > metrics["innerHeight"] + 1 or metrics["bodyHeight"] > metrics["innerHeight"] + 1:
        raise AssertionError(f"{viewport_name}: page shell gained an outer vertical scrollbar: {metrics}")
    return metrics


def check_header_controls(page, viewport_name: str) -> None:
    chapter_tab = page.locator("#chapterTabs .tab")
    if chapter_tab.count() != 1 or not chapter_tab.is_visible():
        raise AssertionError(f"{viewport_name}: chapter tab is not visible")
    controls = page.locator(".header .tools > .tool-btn, .header .tools .account-btn")
    if controls.count() != 5:
        raise AssertionError(f"{viewport_name}: expected five header tools, got {controls.count()}")
    for index in range(controls.count()):
        control = controls.nth(index)
        if not control.is_visible():
            raise AssertionError(f"{viewport_name}: header tool {index} is hidden")
        box = control.bounding_box()
        if not box or box["x"] < 0 or box["x"] + box["width"] > page.viewport_size["width"] + 1:
            raise AssertionError(f"{viewport_name}: header tool {index} is clipped: {box}")


def open_card(page, card_id: str) -> None:
    header = page.locator(f'.card-header[data-kp-id="{card_id}"]')
    header.wait_for(state="visible")
    body = page.locator(f"#kp-{card_id} .card-body")
    if "hidden" in (body.get_attribute("class") or ""):
        header.click()
    body.wait_for(state="visible")


def check_table_mode(page, viewport_name: str) -> None:
    open_card(page, "1-2-1")
    desktop_tables = page.locator("#kp-1-2-1 .params-table")
    mobile_tables = page.locator("#kp-1-2-1 .params-table-mobile")
    if desktop_tables.count() < 2 or mobile_tables.count() != desktop_tables.count():
        raise AssertionError(
            f"{viewport_name}: expected paired desktop/mobile output for every native table"
        )
    if viewport_name == "mobile":
        if not all(mobile_tables.nth(index).is_visible() for index in range(mobile_tables.count())):
            raise AssertionError(f"{viewport_name}: native table did not enter record mode")
        if any(desktop_tables.nth(index).is_visible() for index in range(desktop_tables.count())):
            raise AssertionError(f"{viewport_name}: desktop table remained visible")
    else:
        if not all(desktop_tables.nth(index).is_visible() for index in range(desktop_tables.count())):
            raise AssertionError(f"{viewport_name}: semantic desktop table is hidden")
    open_card(page, "1-2-2")
    list_indent = page.locator("#kp-1-2-2 .course-list").first.evaluate(
        """list => {
          const body = list.closest('.card-body-content');
          const bodyStyle = getComputedStyle(body);
          const listStyle = getComputedStyle(list);
          const contentLeft = body.getBoundingClientRect().left + parseFloat(bodyStyle.paddingLeft);
          return {
            offset: list.getBoundingClientRect().left - contentLeft,
            em: parseFloat(listStyle.fontSize),
          };
        }"""
    )
    if not 1.9 * list_indent["em"] <= list_indent["offset"] <= 2.1 * list_indent["em"]:
        raise AssertionError(f"{viewport_name}: ordered-list block is not indented two characters: {list_indent}")
    assert_no_overflow(page, f"{viewport_name} after table")


def check_sidebar(page, viewport_name: str) -> None:
    if viewport_name == "mobile":
        page.locator('[data-action="toggle-sidebar"]').click()
        page.locator("#sidebar.show").wait_for(state="visible")
    section_label = page.locator("#tree-section-1-2")
    section_style = section_label.evaluate(
        """node => {
          const style = getComputedStyle(node);
          return {
            borderRadius: parseFloat(style.borderRadius),
            borderWidth: parseFloat(style.borderTopWidth),
            borderStyle: style.borderTopStyle,
          };
        }"""
    )
    if section_style["borderRadius"] <= 0 or section_style["borderWidth"] != 0 or section_style["borderStyle"] != "none":
        raise AssertionError(f"{viewport_name}: section label is not rounded and border-free: {section_style}")
    chapter_title = page.locator('.tree-chapter[data-ch="1"] .tree-title')
    normal_background = chapter_title.evaluate("node => getComputedStyle(node).backgroundColor")
    chapter_title.hover()
    page.wait_for_timeout(60)
    hover_style = chapter_title.evaluate(
        """node => ({
          background: getComputedStyle(node).backgroundColor,
          radius: parseFloat(getComputedStyle(node).borderRadius),
          width: node.getBoundingClientRect().width,
          parentWidth: node.parentElement.getBoundingClientRect().width,
        })"""
    )
    if hover_style["radius"] <= 0 or hover_style["width"] >= hover_style["parentWidth"] - 1 or hover_style["background"] == normal_background:
        raise AssertionError(f"{viewport_name}: chapter hover is not an inset rounded rectangle: {hover_style}")
    chapter_body = page.locator('#tree-chapter-1')
    expanded_height = chapter_body.evaluate("node => node.getBoundingClientRect().height")
    chapter_title.click()
    page.wait_for_timeout(320)
    collapsed_height = chapter_body.evaluate("node => node.getBoundingClientRect().height")
    if chapter_title.get_attribute("aria-expanded") != "false" or collapsed_height > 1:
        raise AssertionError(f"{viewport_name}: chapter did not animate closed: {collapsed_height}")
    chapter_title.click()
    page.wait_for_timeout(320)
    reopened_height = chapter_body.evaluate("node => node.getBoundingClientRect().height")
    if chapter_title.get_attribute("aria-expanded") != "true" or reopened_height < expanded_height - 1:
        raise AssertionError(f"{viewport_name}: chapter did not animate open: {reopened_height}")
    if viewport_name != "mobile":
        page.locator('.tree-item[data-card="kp-1-2-4"]').click()
        page.wait_for_timeout(420)
        page.locator('.tree-item[data-card="kp-1-2-2"]').click()
        page.wait_for_timeout(420)
        alignment = page.evaluate(
            """() => {
              const main = document.querySelector('.main');
              const target = document.querySelector('#kp-1-2-2');
              return {
                offset: target.getBoundingClientRect().top - main.getBoundingClientRect().top,
                scrollTop: main.scrollTop,
              };
            }"""
        )
        if not 10 <= alignment["offset"] <= 14:
            raise AssertionError(f"{viewport_name}: card title is not aligned below the main viewport edge: {alignment}")
        sidebar = page.locator("#sidebar")
        box = sidebar.bounding_box()
        if not box:
            raise AssertionError(f"{viewport_name}: sidebar has no bounding box")
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.mouse.wheel(0, 360)
        page.wait_for_timeout(120)
        after_wheel = page.locator(".main").evaluate("node => node.scrollTop")
        if abs(after_wheel - alignment["scrollTop"]) > 1:
            raise AssertionError(
                f"{viewport_name}: wheel over sidebar moved the main content: "
                f"before={alignment['scrollTop']}, after={after_wheel}"
            )
        section_label.click()
        page.wait_for_timeout(120)
        overview_offset = page.evaluate(
            """() => {
              const main = document.querySelector('.main');
              const overview = document.querySelector('#overview-1-2');
              return overview.getBoundingClientRect().top - main.getBoundingClientRect().top;
            }"""
        )
        if not 10 <= overview_offset <= 14:
            raise AssertionError(f"{viewport_name}: section title is clipped at the main viewport edge: {overview_offset}")
    target = page.locator('.tree-item[data-card="kp-1-2-4"]')
    target.wait_for(state="visible")
    target.click()
    page.locator("#kp-1-2-4 .card-body").wait_for(state="visible")
    if viewport_name == "mobile":
        page.locator("#sidebar:not(.show)").wait_for(state="attached")
    assert_no_overflow(page, f"{viewport_name} after sidebar navigation")


def check_theory_cards(page, viewport_name: str) -> None:
    open_card(page, "1-2-2")
    open_card(page, "1-2-3")
    if page.locator("#kp-1-2-2 .course-html, #kp-1-2-3 .course-html").count():
        raise AssertionError(f"{viewport_name}: theory card fell back to legacy HTML")
    tabs = page.locator("#kp-1-2-3 .tab-set-tab")
    if tabs.count() != 2:
        raise AssertionError(f"{viewport_name}: oxidation theory/video tab count changed")
    tabs.nth(1).click()
    tabs.nth(1).press("ArrowLeft")
    if tabs.nth(0).get_attribute("aria-selected") != "true":
        raise AssertionError(f"{viewport_name}: ArrowLeft did not restore the theory tab")
    images = page.locator("#kp-1-2-2 img, #kp-1-2-3 img")
    if not images.count():
        raise AssertionError(f"{viewport_name}: theory images are missing")
    visible_images = 0
    for index in range(images.count()):
        image = images.nth(index)
        if not image.is_visible():
            continue
        visible_images += 1
        image.scroll_into_view_if_needed()
        dimensions = image.evaluate(
            """async image => {
              await image.decode();
              return { width: image.naturalWidth, height: image.naturalHeight };
            }"""
        )
        if dimensions["width"] <= 0 or dimensions["height"] <= 0:
            raise AssertionError(f"{viewport_name}: visible theory image did not decode: {dimensions}")
    if not visible_images:
        raise AssertionError(f"{viewport_name}: no theory image is visible at this breakpoint")
    assert_no_overflow(page, f"{viewport_name} after all theory cards")


def check_section_quiz_feedback(page, viewport_name: str) -> None:
    open_card(page, "1-2-2")
    item = page.locator('#kp-1-2-2 .quiz-item[data-qid="1-003"]')
    correct_label = item.locator('label:has(input[value="A"])')
    wrong_label = item.locator('label:has(input[value="B"])')
    wrong_label.click()
    item.locator('[data-action="submit-quiz"]').click()
    page.wait_for_timeout(220)
    if "correct" not in (correct_label.get_attribute("class") or "") or "wrong" not in (wrong_label.get_attribute("class") or ""):
        raise AssertionError(f"{viewport_name}: wrong quiz answer did not highlight both selected and correct options")
    if item.locator(".quiz-opt.correct").count() != 1 or item.locator(".quiz-opt.wrong").count() != 1:
        raise AssertionError(f"{viewport_name}: quiz option feedback is not unique")
    feedback_class = item.locator(".quiz-fb").get_attribute("class") or ""
    if "show" not in feedback_class or "wrong" not in feedback_class:
        raise AssertionError(f"{viewport_name}: wrong quiz feedback is not visible")
    item.evaluate(
        """node => {
          node.querySelectorAll('.quiz-opt').forEach(option => option.classList.remove('correct', 'wrong'));
          node.querySelectorAll('input').forEach(input => { input.checked = false; });
        }"""
    )
    page.locator('#chapterTabs .tab[data-chapter="1"]').click()
    restored = page.locator('#kp-1-2-2 .quiz-item[data-qid="1-003"]')
    if (
        "correct" not in (restored.locator('label:has(input[value="A"])').get_attribute("class") or "")
        or "wrong" not in (restored.locator('label:has(input[value="B"])').get_attribute("class") or "")
        or not restored.locator('input[value="B"]').is_checked()
    ):
        raise AssertionError(f"{viewport_name}: quiz option feedback was not restored in the current session")


def nontransparent_pixels(canvas) -> int:
    return canvas.evaluate(
        """canvas => {
          const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          let count = 0;
          for (let index = 3; index < data.length; index += 4) if (data[index] !== 0) count += 1;
          return count;
        }"""
    )


def check_tabs_and_canvas(page, viewport_name: str) -> dict:
    open_card(page, "1-2-4")
    tabs = page.locator("#kp-1-2-4 .tab-set-tab")
    if tabs.count() != 4:
        raise AssertionError(f"{viewport_name}: expected four experiment tabs, got {tabs.count()}")

    tabs.nth(1).click()
    frame_locator = page.frame_locator("#kp-1-2-4 .sandbox-frame")
    frame_locator.locator("[data-oxidation-simulation]").wait_for(state="visible")
    selects = frame_locator.locator("select")
    if selects.count() != 5:
        raise AssertionError(f"{viewport_name}: expected five curve selectors, got {selects.count()}")
    frame_element = page.locator("#kp-1-2-4 .sandbox-frame")
    frame_metrics = None
    for _ in range(60):
        frame_metrics = frame_locator.locator("body").evaluate(
            """() => {
              const html = document.documentElement;
              const body = document.body;
              const root = document.querySelector('[data-oxidation-simulation]');
              const canvas = root.querySelector('canvas');
              const rootRect = root.getBoundingClientRect();
              const canvasRect = canvas.getBoundingClientRect();
              return {
                htmlScrollHeight: html.scrollHeight,
                htmlClientHeight: html.clientHeight,
                htmlScrollTop: html.scrollTop,
                htmlOverflowY: getComputedStyle(html).overflowY,
                bodyScrollTop: body.scrollTop,
                bodyOverflowY: getComputedStyle(body).overflowY,
                canvasInsideRoot: canvasRect.bottom <= rootRect.bottom + 1,
              };
            }"""
        )
        frame_metrics["iframeHeight"] = frame_element.evaluate("node => node.getBoundingClientRect().height")
        frame_metrics.update(
            frame_element.evaluate(
                """node => ({
                  iframeBottom: node.getBoundingClientRect().bottom,
                  cardBodyBottom: node.closest('.card-body').getBoundingClientRect().bottom,
                })"""
            )
        )
        if (
            abs(frame_metrics["iframeHeight"] - frame_metrics["htmlScrollHeight"]) <= 2
            and frame_metrics["htmlScrollHeight"] <= frame_metrics["htmlClientHeight"] + 2
            and frame_metrics["iframeBottom"] <= frame_metrics["cardBodyBottom"] + 1
        ):
            break
        page.wait_for_timeout(50)
    else:
        raise AssertionError(f"{viewport_name}: sandbox height did not converge: {frame_metrics}")
    if (
        frame_metrics["htmlOverflowY"] != "hidden"
        or frame_metrics["bodyOverflowY"] != "hidden"
        or frame_metrics["htmlScrollTop"] != 0
        or frame_metrics["bodyScrollTop"] != 0
        or not frame_metrics["canvasInsideRoot"]
    ):
        raise AssertionError(f"{viewport_name}: sandbox still owns an internal scroll area: {frame_metrics}")

    outer_tab_height = tabs.nth(0).bounding_box()["height"]
    select_height = selects.nth(0).bounding_box()["height"]
    if abs(select_height - outer_tab_height) > 2:
        raise AssertionError(
            f"{viewport_name}: sandbox select height does not match outer tabs: "
            f"select={select_height}, tab={outer_tab_height}"
        )

    frame_element.scroll_into_view_if_needed()
    scroll_state = page.locator(".main").evaluate(
        """node => {
          const max = node.scrollHeight - node.clientHeight;
          if (max - node.scrollTop < 260) node.scrollTop = Math.max(0, max - 520);
          return { before: node.scrollTop, max };
        }"""
    )
    frame_box = frame_element.bounding_box()
    footer_top = page.locator(".app-footer").bounding_box()["y"]
    pointer_y = min(footer_top - 12, max(70, frame_box["y"] + min(260, frame_box["height"] / 2)))
    page.mouse.move(frame_box["x"] + frame_box["width"] * 0.75, pointer_y)
    page.mouse.wheel(0, 240)
    page.wait_for_timeout(100)
    outside_after = page.locator(".main").evaluate("node => node.scrollTop")
    inside_after = frame_locator.locator("body").evaluate(
        "() => ({ html: document.documentElement.scrollTop, body: document.body.scrollTop })"
    )
    if outside_after <= scroll_state["before"] or inside_after != {"html": 0, "body": 0}:
        raise AssertionError(
            f"{viewport_name}: wheel over sandbox did not stay with the outer scroller: "
            f"before={scroll_state['before']}, after={outside_after}, inside={inside_after}"
        )
    expected = ["", "", "", "", ""]
    actual = [selects.nth(index).input_value() for index in range(5)]
    if actual != expected:
        raise AssertionError(f"{viewport_name}: initial values {actual}, expected {expected}")

    canvas = frame_locator.locator("canvas")
    draw_button = frame_locator.locator('[data-draw-oxidation]')
    clear_button = frame_locator.locator('[data-clear-oxidation]')
    practice_button = page.locator('#kp-1-2-4 .sandbox-wrapper [data-action="switch-sandbox-mode"][data-mode="practice"]')
    answer_button = page.locator('#kp-1-2-4 .sandbox-wrapper [data-action="switch-sandbox-mode"][data-mode="answer"]')
    if not draw_button.is_visible() or not clear_button.is_visible() or not practice_button.is_visible() or not answer_button.is_visible():
        raise AssertionError(f"{viewport_name}: oxidation controls are not all visible")
    if frame_locator.locator('[data-answer-oxidation], [data-oxidation-mode]').count():
        raise AssertionError(f"{viewport_name}: iframe still duplicates the outer answer-mode controls")
    if "step-simulation-modes" not in (answer_button.locator("xpath=..").get_attribute("class") or ""):
        raise AssertionError(f"{viewport_name}: answer control does not reuse the native segmented style")
    before_pixels = nontransparent_pixels(canvas)
    if before_pixels != 0:
        raise AssertionError(f"{viewport_name}: Canvas must be transparent before the first click")
    before = digest(canvas.screenshot())
    draw_button.click()
    if "请选择预热温度" not in (frame_locator.locator('[data-oxidation-status]').text_content() or ""):
        raise AssertionError(f"{viewport_name}: empty practice submission did not report the first missing parameter")
    if nontransparent_pixels(canvas) != 0:
        raise AssertionError(f"{viewport_name}: empty practice submission drew a curve")

    answer_button.click()
    page.wait_for_timeout(150)
    answer_values = [selects.nth(index).input_value() for index in range(5)]
    if answer_values != ["800", "850", "920", "20", "60"]:
        raise AssertionError(f"{viewport_name}: reference values {answer_values} are incomplete")
    if any(not selects.nth(index).is_disabled() for index in range(5)):
        raise AssertionError(f"{viewport_name}: reference-answer selectors must be read-only")
    if answer_button.get_attribute("aria-pressed") != "true" or practice_button.get_attribute("aria-pressed") != "false":
        raise AssertionError(f"{viewport_name}: outer reference-answer state is missing")
    answer_pixels = nontransparent_pixels(canvas)
    if answer_pixels == 0:
        raise AssertionError(f"{viewport_name}: reference-answer mode did not draw the answer curve")

    practice_button.click()
    page.wait_for_timeout(100)
    returned_values = [selects.nth(index).input_value() for index in range(5)]
    if returned_values != expected or any(selects.nth(index).is_disabled() for index in range(5)):
        raise AssertionError(f"{viewport_name}: returning to practice did not clear editable selectors")
    if nontransparent_pixels(canvas) != 0:
        raise AssertionError(f"{viewport_name}: returning to practice did not clear the Canvas")
    score_chip = page.locator("#kp-1-2-4 .sandbox-score-chip")

    for index, value in enumerate(["800", "850", "920", "20", "60"]):
        selects.nth(index).select_option(value)
    draw_button.click()
    page.wait_for_timeout(150)
    after_correct = digest(canvas.screenshot())
    correct_pixels = nontransparent_pixels(canvas)
    if before == after_correct:
        raise AssertionError(f"{viewport_name}: clicking curve simulation did not change canvas pixels")
    if correct_pixels == 0:
        raise AssertionError(f"{viewport_name}: correct parameters produced an empty Canvas")
    score_chip.wait_for(state="visible")
    answer_button.click()
    page.wait_for_timeout(150)
    if score_chip.count() != 0:
        raise AssertionError(f"{viewport_name}: switching to reference answers did not remove the stale score chip")
    clear_button.click()
    page.wait_for_timeout(100)
    if practice_button.get_attribute("aria-pressed") != "true" or answer_button.get_attribute("aria-pressed") != "false":
        raise AssertionError(f"{viewport_name}: iframe clear did not synchronize the outer practice mode")
    if [selects.nth(index).input_value() for index in range(5)] != expected or nontransparent_pixels(canvas) != 0:
        raise AssertionError(f"{viewport_name}: clear from reference mode did not reset the practice canvas")

    alternatives = ["500", "500", "500", "10", "10"]
    for index, value in enumerate(alternatives):
        selects.nth(index).select_option(value)
    draw_button.click()
    page.wait_for_timeout(150)
    after_alternative = digest(canvas.screenshot())
    alternative_pixels = nontransparent_pixels(canvas)
    if after_alternative == after_correct:
        raise AssertionError(f"{viewport_name}: alternative parameters produced identical canvas pixels")

    page.wait_for_timeout(1_500)
    persisted = page.evaluate(
        """() => {
          const raw = localStorage.getItem(
            'pglib:u:qa-user:autosmt-oxidation-golden:simulations'
          );
          return raw ? JSON.parse(raw) : null;
        }"""
    )
    persisted_key = "sandbox:experiment-1-oxidation-temperature-curve"
    persisted_entry = (persisted or {}).get(persisted_key)
    if not persisted_entry or persisted_entry.get("score") != {"score": 0, "total": 5, "detail": ""}:
        raise AssertionError(f"{viewport_name}: logged-in sandbox score was not persisted: {persisted}")
    persisted_values = [item.get("value") for item in persisted_entry.get("controls", [])]
    if persisted_values != alternatives:
        raise AssertionError(f"{viewport_name}: logged-in sandbox controls were not persisted: {persisted_values}")

    for transition in ("refresh", "reenter"):
        if transition == "refresh":
            page.reload(wait_until="domcontentloaded", timeout=60_000)
        else:
            page.goto(URL, wait_until="domcontentloaded", timeout=60_000)
        try:
            page.wait_for_load_state("networkidle", timeout=15_000)
        except PlaywrightTimeoutError:
            pass
        page.locator('.card-header[data-kp-id="1-2-4"]').wait_for(state="visible", timeout=30_000)
        open_card(page, "1-2-4")
        tabs = page.locator("#kp-1-2-4 .tab-set-tab")
        tabs.nth(1).click()
        frame_locator = page.frame_locator("#kp-1-2-4 .sandbox-frame")
        frame_locator.locator("[data-oxidation-simulation]").wait_for(state="visible")
        selects = frame_locator.locator("select")
        restored_values = [selects.nth(index).input_value() for index in range(5)]
        if restored_values != alternatives:
            raise AssertionError(
                f"{viewport_name}: {transition} did not restore sandbox controls: {restored_values}"
            )
        score_chip = page.locator("#kp-1-2-4 .sandbox-score-chip")
        score_chip.wait_for(state="visible")
        if "正确率 0/5" not in (score_chip.text_content() or ""):
            raise AssertionError(f"{viewport_name}: {transition} did not restore sandbox score")

    open_card(page, "1-2-2")
    restored_quiz = page.locator('#kp-1-2-2 .quiz-item[data-qid="1-003"]')
    if (
        not restored_quiz.locator('input[value="B"]').is_checked()
        or "correct" not in (restored_quiz.locator('label:has(input[value="A"])').get_attribute("class") or "")
        or "wrong" not in (restored_quiz.locator('label:has(input[value="B"])').get_attribute("class") or "")
    ):
        raise AssertionError(f"{viewport_name}: logged-in quiz feedback did not survive re-entry")

    open_card(page, "1-2-4")
    tabs = page.locator("#kp-1-2-4 .tab-set-tab")
    tabs.nth(1).click()
    frame_locator = page.frame_locator("#kp-1-2-4 .sandbox-frame")
    frame_locator.locator("[data-oxidation-simulation]").wait_for(state="visible")
    selects = frame_locator.locator("select")
    canvas = frame_locator.locator("canvas")
    clear_button = frame_locator.locator('[data-clear-oxidation]')
    clear_button.click()
    page.wait_for_timeout(180)
    if [selects.nth(index).input_value() for index in range(5)] != expected:
        raise AssertionError(f"{viewport_name}: clear button did not reset all parameters")
    if nontransparent_pixels(canvas) != 0:
        raise AssertionError(f"{viewport_name}: clear button did not clear the Canvas")
    if page.locator("#kp-1-2-4 .sandbox-score-chip").count() != 0:
        raise AssertionError(f"{viewport_name}: clear button did not remove the stale score chip")
    canvas_screenshot = QA_DIR / f"oxidation-golden-{viewport_name}-canvas.png"
    canvas.screenshot(path=str(canvas_screenshot))

    tabs.nth(1).press("Home")
    if tabs.nth(0).get_attribute("aria-selected") != "true":
        raise AssertionError(f"{viewport_name}: Home did not activate the first experiment tab")
    tabs.nth(0).press("End")
    if tabs.nth(3).get_attribute("aria-selected") != "true":
        raise AssertionError(f"{viewport_name}: End did not activate the last experiment tab")
    tabs.nth(1).click()

    assert_no_overflow(page, f"{viewport_name} after Canvas")
    return {
        "before": before,
        "correct": after_correct,
        "alternative": after_alternative,
        "pixels": {
            "before": before_pixels,
            "correct": correct_pixels,
            "alternative": alternative_pixels,
        },
        "canvasScreenshot": str(canvas_screenshot.relative_to(ROOT)).replace("\\", "/"),
        "persistence": {
            "namespace": "qa-user",
            "sandboxKey": persisted_key,
            "refresh": True,
            "reenter": True,
            "quizFeedback": True,
        },
    }


def verify_media_ranges(page, context) -> list[dict]:
    urls = page.locator("video source").evaluate_all("nodes => [...new Set(nodes.map(node => node.src))]")
    checks = []
    for url in urls:
        response = context.request.get(url, headers={"Range": "bytes=0-1023"})
        body = response.body()
        checks.append({"url": url, "status": response.status, "bytes": len(body)})
        if response.status != 206 or len(body) != 1024:
            raise AssertionError(f"media Range request failed: {checks[-1]}")
    if len(checks) != 4:
        raise AssertionError(f"expected four local videos, got {len(checks)}")
    return checks


def unexpected_browser_errors(console_errors: list[str], failed_requests: list[str]) -> dict:
    optional_backend_failed = any("localhost:8787/api/me" in item for item in failed_requests)
    ignored_requests = [
        item
        for item in failed_requests
        if ("localhost:8787/api/me" in item and "ERR_CONNECTION_REFUSED" in item)
        or (
            "/courses/autosmt-previews/autosmt-oxidation-golden/assets/media/" in item
            and "ERR_ABORTED" in item
        )
    ]
    unexpected_requests = [item for item in failed_requests if item not in ignored_requests]
    ignored_console = [
        item
        for item in console_errors
        if optional_backend_failed and item == "Failed to load resource: net::ERR_CONNECTION_REFUSED"
    ]
    unexpected_console = [item for item in console_errors if item not in ignored_console]
    return {
        "ignoredConsole": ignored_console,
        "ignoredRequests": ignored_requests,
        "unexpectedConsole": unexpected_console,
        "unexpectedRequests": unexpected_requests,
    }


def run() -> None:
    screenshots = {}
    results = {}
    errors = {}
    artifacts = {
        "sourceLedger": file_evidence(COURSE_DIR / "source-ledger.json"),
        "deploymentPackage": file_evidence(DEPLOYMENT_PACKAGE),
        "fullPackage": file_evidence(FULL_PACKAGE),
    }
    with sync_playwright() as playwright:
        executable = local_chromium()
        launch_options = {"headless": True}
        if executable:
            launch_options["executable_path"] = executable
        browser = playwright.chromium.launch(**launch_options)
        for width, height, name in VIEWPORTS:
            context = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=1)
            sync_requests = []
            install_mock_sync(context, sync_requests)
            page = context.new_page()
            console_errors = []
            page_errors = []
            failed_requests = []
            all_requests = []
            sandbox_requests = []
            page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
            page.on("pageerror", lambda error: page_errors.append(str(error)))
            page.on("requestfailed", lambda request: failed_requests.append(f"{request.url}: {request.failure}"))
            page.on(
                "request",
                lambda request: (
                    all_requests.append(request.url),
                    sandbox_requests.append(request.url)
                    if request.frame and request.frame.url.startswith("about:srcdoc")
                    else None,
                ),
            )
            try:
                page.goto(URL, wait_until="domcontentloaded", timeout=60_000)
                try:
                    page.wait_for_load_state("networkidle", timeout=60_000)
                except PlaywrightTimeoutError:
                    # Lazy media can keep a connection open; DOM readiness is enough after the timeout.
                    pass
                page.locator('.card-header[data-kp-id="1-2-1"]').wait_for(state="visible", timeout=30_000)
                if "AutoSMT" not in (page.locator("#courseLogo").text_content() or ""):
                    raise AssertionError(f"{name}: course title not rendered")
                check_initial_collapsed_state(page, name)
                check_card_animation(page, name)
                check_header_controls(page, name)
                check_sidebar(page, name)
                check_table_mode(page, name)
                check_theory_cards(page, name)
                check_section_quiz_feedback(page, name)
                results[name] = check_tabs_and_canvas(page, name)
                media_checks = verify_media_ranges(page, context) if name in {"desktop", "wide"} else []
                assert_no_overflow(page, f"{name} final")
                footer_layout = check_footer_layout(page, name)
                screenshot = QA_DIR / f"oxidation-golden-{name}.png"
                page.screenshot(path=str(screenshot), full_page=True)
                screenshots[name] = str(screenshot.relative_to(ROOT)).replace("\\", "/")
                classified = unexpected_browser_errors(console_errors, failed_requests)
                errors[name] = {
                    "console": console_errors,
                    "page": page_errors,
                    "requests": failed_requests,
                    "classified": classified,
                    "mediaRanges": media_checks,
                    "syncRequests": sync_requests,
                    "sandboxRequests": sandbox_requests,
                    "externalRequests": [
                        url for url in all_requests
                        if not (
                            url.startswith("http://127.0.0.1:5173/")
                            or url.startswith("http://localhost:5173/")
                            or url.startswith("http://localhost:8787/")
                            or url.startswith("blob:")
                            or url.startswith("data:")
                        )
                    ],
                    "layout": layout_metrics(page),
                    "footerLayout": footer_layout,
                }
                if (
                    classified["unexpectedConsole"]
                    or page_errors
                    or classified["unexpectedRequests"]
                    or sandbox_requests
                    or errors[name]["externalRequests"]
                ):
                    raise AssertionError(f"{name}: browser errors {errors[name]}")
            finally:
                context.close()
        browser.close()

    report = {
        "url": URL,
        "viewports": results,
        "screenshots": screenshots,
        "errors": errors,
        "artifacts": artifacts,
    }
    report_path = QA_DIR / "oxidation-golden-browser.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    run()
