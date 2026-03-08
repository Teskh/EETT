document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("catalogTreeSearch");
  const filterRoot = document.querySelector("[data-tree-filter-target]");
  if (!input || !filterRoot) {
    return;
  }

  const items = Array.from(filterRoot.querySelectorAll("[data-filter-item]"));
  input.addEventListener("input", () => {
    const term = input.value.trim().toLowerCase();
    items.forEach((item) => {
      const text = item.textContent.toLowerCase();
      item.classList.toggle("is-hidden", term !== "" && !text.includes(term));
    });
  });
});
