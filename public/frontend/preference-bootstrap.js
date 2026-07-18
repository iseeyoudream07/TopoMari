(() => {
  const preferredTheme = () => typeof matchMedia === "function"
    && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const preferredLanguage = () => typeof navigator !== "undefined"
    && String(navigator.language || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en";
  let theme = preferredTheme();
  let language = preferredLanguage();

  try {
    const savedTheme = localStorage.getItem("topomari-theme");
    if (savedTheme === "light" || savedTheme === "dark") theme = savedTheme;
    const savedLanguage = localStorage.getItem("topomari-language");
    if (savedLanguage === "en" || savedLanguage === "zh-CN") language = savedLanguage;
  } catch {
    // Browser preferences remain active when storage is unavailable.
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.lang = language;
  document.documentElement.style.colorScheme = theme;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute("content", theme === "dark" ? "#1c1b19" : "#eeede5");
})();
