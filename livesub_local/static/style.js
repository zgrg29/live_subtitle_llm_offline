/* 字幕スタイルを CSS 変数として要素に流し込む。studio と /view で共有。 */
(function (global) {
  "use strict";

  var DEFAULT_FONT = '"Hiragino Sans", "Yu Gothic UI", "Noto Sans JP", "Microsoft YaHei", sans-serif';

  function clamp(value, low, high, fallback) {
    var number = Number(value);
    if (!isFinite(number)) return fallback;
    return Math.max(low, Math.min(high, number));
  }

  function rgba(hex, alphaPercent) {
    var value = String(hex || "#000000").replace("#", "");
    if (value.length !== 6) value = "000000";
    var r = parseInt(value.slice(0, 2), 16) || 0;
    var g = parseInt(value.slice(2, 4), 16) || 0;
    var b = parseInt(value.slice(4, 6), 16) || 0;
    var a = clamp(alphaPercent, 0, 100, 0) / 100;
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }

  function apply(stage, display) {
    if (!stage || !display) return;
    var style = stage.style;
    style.setProperty("--target-size", clamp(display.target_size, 12, 140, 44) + "px");
    style.setProperty("--source-size", clamp(display.source_size, 10, 120, 26) + "px");
    style.setProperty("--target-color", display.target_color || "#ffffff");
    style.setProperty("--source-color", display.source_color || "#b9c6d4");
    style.setProperty("--outline", clamp(display.outline_width, 0, 12, 4) + "px");
    style.setProperty("--outline-color", display.outline_color || "#000000");
    style.setProperty("--gap", clamp(display.line_gap, 0, 40, 10) + "px");
    style.setProperty("--fade", clamp(display.fade_ms, 0, 2000, 160) + "ms");
    style.setProperty("--pair-bg", rgba(display.background_color, display.background_alpha));
    style.setProperty("--sub-font", display.font_family || DEFAULT_FONT);
    stage.setAttribute("data-position", display.position === "top" ? "top" : "bottom");
  }

  global.LiveSubStyle = { apply: apply, rgba: rgba, clamp: clamp, DEFAULT_FONT: DEFAULT_FONT };
})(window);
