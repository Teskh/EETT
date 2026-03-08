document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("projectCategorySearch");
  const links = Array.from(document.querySelectorAll("[data-category-link]"));
  if (!input || links.length === 0) {
    return;
  }

  input.addEventListener("input", () => {
    const term = input.value.trim().toLowerCase();
    links.forEach((link) => {
      const matches = link.textContent.toLowerCase().includes(term);
      link.classList.toggle("is-hidden", term !== "" && !matches);
    });
  });
});
