// Synthetic, local-only interactive site. No employee or course data.
async function loadLesson(unit) {
  const target = document.getElementById("lesson");
  target.textContent = "Loading…";
  try {
    const response = await fetch("/api/lesson?unit=" + encodeURIComponent(unit));
    if (!response.ok) throw new Error("Lesson unavailable");
    const lesson = await response.json();
    const heading = document.createElement("h3"); heading.textContent = lesson.title;
    const paragraph = document.createElement("p"); paragraph.textContent = lesson.body;
    const source = document.createElement("small"); source.textContent = "API-REPLAY-CHECK: " + unit;
    target.replaceChildren(heading, paragraph, source);
  } catch { target.textContent = "This lesson was not available in the captured archive."; }
}
for (const button of document.querySelectorAll("button[data-unit]")) {
  button.addEventListener("click", () => { void loadLesson(button.dataset.unit); });
}
if (location.pathname === "/reference") document.getElementById("title").textContent = "Reference guide";
if (location.pathname === "/lesson") {
  document.getElementById("title").textContent = "Tools lesson";
  void loadLesson(new URLSearchParams(location.search).get("unit") || "tools");
}
