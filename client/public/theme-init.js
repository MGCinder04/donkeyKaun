(function () {
  try {
    var raw = localStorage.getItem("dk-theme");
    var theme = raw && JSON.parse(raw).state.theme;
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
    }
  } catch {
    // A malformed local preference should never stop the application from loading.
  }
})();
