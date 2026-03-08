document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("projectCategorySearch");
  const links = Array.from(document.querySelectorAll("[data-category-link]"));
  if (input && links.length > 0) {
    input.addEventListener("input", () => {
      const term = input.value.trim().toLowerCase();
      links.forEach((link) => {
        const matches = link.textContent.toLowerCase().includes(term);
        link.classList.toggle("is-hidden", term !== "" && !matches);
      });
    });
  }

  const modalLookup = new Map(
    Array.from(document.querySelectorAll("[data-modal]")).map((modal) => [modal.dataset.modal, modal]),
  );

  const closeModal = (modal) => {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
  };

  const openModal = (modal) => {
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");

    const form = modal.querySelector("[data-component-prefill-form]");
    if (form) {
      syncPrefill(form);
    }
  };

  document.querySelectorAll("[data-modal-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const modal = modalLookup.get(button.dataset.modalOpen);
      if (modal) {
        openModal(modal);
      }
    });
  });

  document.querySelectorAll("[data-modal-close]").forEach((button) => {
    button.addEventListener("click", () => {
      const modal = button.closest("[data-modal]");
      if (modal) {
        closeModal(modal);
      }
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    document.querySelectorAll("[data-modal].is-open").forEach((modal) => closeModal(modal));
  });

  const syncPrefill = (form) => {
    const select = form.querySelector("[data-component-select]");
    if (!select) {
      return;
    }
    const option = select.selectedOptions[0];
    if (!option) {
      return;
    }
    const fields = {
      name: option.dataset.name || "",
      short_name: option.dataset.shortName || "",
      description: option.dataset.description || "",
      installation: option.dataset.installation || "",
    };
    Object.entries(fields).forEach(([key, value]) => {
      const target = form.querySelector(`[data-prefill-target="${key}"]`);
      if (target) {
        target.value = value;
      }
    });
  };

  document.querySelectorAll("[data-component-prefill-form]").forEach((form) => {
    const select = form.querySelector("[data-component-select]");
    if (!select) {
      return;
    }
    select.addEventListener("change", () => syncPrefill(form));
    syncPrefill(form);
  });
});
