// Tacit website: offer the right installer for the visitor's computer. Without JavaScript the
// buttons point at the download section, which lists every platform.
(function () {
  "use strict";

  var BASE = "https://github.com/GsnMithra/tacit-app/releases/latest/download/";
  var FILES = {
    "mac-arm64": { file: "Tacit-mac-arm64.dmg", label: "Download for Mac", note: "Apple silicon (M1 and later)" },
    "mac-x64": { file: "Tacit-mac-x64.dmg", label: "Download for Mac", note: "Intel Mac" },
    win: { file: "Tacit-win-x64.exe", label: "Download for Windows", note: "Windows 10 or 11, 64-bit" },
    linux: { file: "Tacit-linux-x86_64.AppImage", label: "Download for Linux", note: "AppImage, x86_64" },
  };

  function guessPlatform() {
    var uaData = navigator.userAgentData;
    var platform = ((uaData && uaData.platform) || navigator.platform || "").toLowerCase();
    var ua = navigator.userAgent.toLowerCase();
    if (/android|iphone|ipad|ipod/.test(ua) || (uaData && uaData.mobile)) return null;
    // iPadOS reports itself as a Mac with touch.
    if (/mac/.test(platform) && navigator.maxTouchPoints > 1) return null;
    if (/mac/.test(platform) || /mac os x/.test(ua)) return "mac-arm64";
    if (/win/.test(platform) || /windows/.test(ua)) return "win";
    if (/linux|x11/.test(platform) || /linux/.test(ua)) return "linux";
    return null;
  }

  function apply(key) {
    var choice = FILES[key];
    if (!choice) return;
    document.querySelectorAll("[data-download]").forEach(function (link) {
      link.href = BASE + choice.file;
      var label = link.querySelector("[data-download-label]");
      if (label) label.textContent = choice.label;
    });
    document.querySelectorAll("[data-download-note]").forEach(function (el) {
      var other =
        key === "mac-arm64"
          ? ' Have an Intel Mac? <a href="' + BASE + FILES["mac-x64"].file + '">Get the Intel version</a>.'
          : key === "mac-x64"
            ? ' Have Apple silicon? <a href="' + BASE + FILES["mac-arm64"].file + '">Get that version</a>.'
            : "";
      el.innerHTML = choice.note + "." + other;
    });
    var family = key.indexOf("mac") === 0 ? "mac" : key;
    document.querySelectorAll("[data-platform]").forEach(function (card) {
      card.classList.toggle("is-yours", card.getAttribute("data-platform") === family);
    });
  }

  var key = guessPlatform();
  if (key) {
    apply(key);
    // Chromium can tell an Intel Mac from Apple silicon; other browsers keep the Apple silicon
    // default and the note offers the Intel file.
    var uaData = navigator.userAgentData;
    if (key === "mac-arm64" && uaData && uaData.getHighEntropyValues) {
      uaData
        .getHighEntropyValues(["architecture"])
        .then(function (v) {
          if (v.architecture === "x86") apply("mac-x64");
        })
        .catch(function () {});
    }
  } else {
    document.querySelectorAll("[data-download-note]").forEach(function (el) {
      el.textContent = "Tacit is a desktop app for macOS, Windows and Linux. Open this page on your computer to download it.";
    });
  }

  var header = document.querySelector(".site-header");
  if (header) {
    var onScroll = function () {
      header.classList.toggle("scrolled", window.scrollY > 8);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });
})();
