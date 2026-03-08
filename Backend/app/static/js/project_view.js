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

  const modals = Array.from(document.querySelectorAll("[data-modal]"));
  modals.forEach((modal) => {
    if (modal.parentElement !== document.body) {
      document.body.appendChild(modal);
    }
  });

  const modalLookup = new Map(modals.map((modal) => [modal.dataset.modal, modal]));

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
    syncCreateAttributeEditor(form, option);
  };

  document.querySelectorAll("[data-component-prefill-form]").forEach((form) => {
    const select = form.querySelector("[data-component-select]");
    if (!select) {
      return;
    }
    select.addEventListener("change", () => syncPrefill(form));
    form.addEventListener("submit", () => syncInstanceAttributePayload(form));
    syncPrefill(form);
  });

  document.querySelectorAll("[data-instance-attribute-form]").forEach((form) => {
    form.addEventListener("submit", () => syncInstanceAttributePayload(form));
  });

  document.querySelectorAll("[data-instance-refresh]").forEach((button) => {
    button.addEventListener("click", async () => {
      const projectId = button.dataset.projectId;
      const instanceId = button.dataset.instanceId;
      if (!projectId || !instanceId) {
        return;
      }

      const originalText = button.innerHTML;
      button.disabled = true;
      button.innerHTML = '<i class="ph-bold ph-spinner-gap animate-spin"></i> Refreshing';

      try {
        const response = await fetch(`/api/v1/projects/${projectId}/instances/${instanceId}/refresh`, {
          method: "POST",
        });
        if (!response.ok) {
          throw new Error("Unable to refresh instance.");
        }
        window.location.reload();
      } catch (error) {
        button.disabled = false;
        button.innerHTML = originalText;
      }
    });
  });
});

function syncCreateAttributeEditor(form, option) {
  const container = form.querySelector("[data-instance-attributes-editor]");
  if (!container) {
    return;
  }

  let attributes = [];
  try {
    attributes = JSON.parse(option.dataset.attributes || "[]");
  } catch (error) {
    attributes = [];
  }

  if (attributes.length === 0) {
    container.innerHTML =
      '<p class="text-xs text-zinc-500 font-mono italic">This component has no catalog attributes.</p>';
    return;
  }

  container.innerHTML = attributes
    .map((attribute) => renderInstanceAttributeField(attribute))
    .join("");
}

function renderInstanceAttributeField(attribute) {
  const name = escapeHtml(attribute.name || "");
  const valueType = attribute.value_type || "text";
  const currentValue = attribute.value || "";
  let control = "";

  if (valueType === "select") {
    const options = Array.isArray(attribute.options) ? attribute.options : [];
    control = `
      <select
        data-instance-attribute-input
        data-attribute-name="${name}"
        class="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-sm text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
      >
        <option value="">Select value</option>
        ${options
          .map(
            (option) =>
              `<option value="${escapeHtml(option)}"${option === currentValue ? " selected" : ""}>${escapeHtml(option)}</option>`,
          )
          .join("")}
      </select>
    `;
  } else {
    control = `
      <input
        type="${valueType === "number" ? "number" : "text"}"
        value="${escapeHtml(currentValue)}"
        data-instance-attribute-input
        data-attribute-name="${name}"
        class="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-sm text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-all font-mono"
        placeholder="Enter value"
      >
    `;
  }

  return `
    <div class="flex flex-col gap-1.5">
      <label class="text-xs font-bold text-zinc-400 uppercase tracking-widest">${name}</label>
      ${control}
    </div>
  `;
}

function syncInstanceAttributePayload(form) {
  const hiddenInput = form.querySelector("[data-instance-attributes-json]");
  if (!hiddenInput) {
    return;
  }

  const attributes = Array.from(form.querySelectorAll("[data-instance-attribute-input]")).map((input) => ({
    name: input.dataset.attributeName || "",
    value: input.value || "",
  }));
  hiddenInput.value = JSON.stringify(attributes);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
