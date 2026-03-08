document.addEventListener("DOMContentLoaded", () => {
  initCatalogTreeFilter();
  initAttributeEditors();
});

function initCatalogTreeFilter() {
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
}

function initAttributeEditors() {
  const editors = document.querySelectorAll("[data-attribute-editor]");
  editors.forEach((form) => {
    const list = form.querySelector("[data-attribute-list]");
    const hiddenInput = form.querySelector("[data-attribute-json]");
    const addButton = form.querySelector("[data-add-attribute]");
    const saveButton = form.querySelector("[data-save-attributes]");
    const saveStatus = form.querySelector("[data-save-status]");
    if (!list || !hiddenInput || !addButton || !saveButton || !saveStatus) {
      return;
    }

    let initialAttributes = [];
    try {
      initialAttributes = JSON.parse(form.dataset.initialAttributes || "[]");
    } catch (error) {
      initialAttributes = [];
    }

    if (initialAttributes.length > 0) {
      initialAttributes.forEach((attribute) => {
        list.appendChild(buildAttributeCard(attribute));
      });
    }
    syncEmptyState(list);

    addButton.addEventListener("click", () => {
      list.appendChild(buildAttributeCard());
      syncEmptyState(list);
    });

    form.addEventListener("click", (event) => {
      const actionButton = event.target.closest("[data-action]");
      if (!actionButton) {
        return;
      }

      const action = actionButton.dataset.action;
      const attributeCard = actionButton.closest("[data-attribute-card]");
      const valueRow = actionButton.closest("[data-value-row]");

      if (action === "remove-attribute" && attributeCard) {
        attributeCard.remove();
        syncEmptyState(list);
        return;
      }
      if (action === "move-attribute-up" && attributeCard) {
        moveElement(attributeCard, -1);
        return;
      }
      if (action === "move-attribute-down" && attributeCard) {
        moveElement(attributeCard, 1);
        return;
      }
      if (action === "add-value" && attributeCard) {
        const valueList = attributeCard.querySelector("[data-value-list]");
        valueList.appendChild(buildValueRow());
        toggleValueControls(attributeCard);
        return;
      }
      if (action === "remove-value" && valueRow && attributeCard) {
        valueRow.remove();
        ensureAtLeastOneValueRow(attributeCard);
        toggleValueControls(attributeCard);
        return;
      }
      if (action === "move-value-up" && valueRow) {
        moveElement(valueRow, -1);
        return;
      }
      if (action === "move-value-down" && valueRow) {
        moveElement(valueRow, 1);
      }
    });

    form.addEventListener("change", (event) => {
      const select = event.target.closest("[data-value-type]");
      if (!select) {
        return;
      }
      const attributeCard = select.closest("[data-attribute-card]");
      toggleValueControls(attributeCard);
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      hiddenInput.value = JSON.stringify(collectAttributes(list));
      saveButton.disabled = true;
      saveStatus.textContent = "Saving attribute set...";

      try {
        const response = await fetch(form.action, {
          method: "POST",
          headers: {
            "x-requested-with": "fetch",
          },
          body: new FormData(form),
        });
        if (!response.ok) {
          throw new Error("Unable to save attribute set.");
        }
        form.dataset.initialAttributes = hiddenInput.value;
        saveStatus.textContent = "Attribute set saved.";
      } catch (error) {
        saveStatus.textContent = "Could not save attribute set.";
      } finally {
        saveButton.disabled = false;
      }
    });
  });
}

function buildAttributeCard(attribute = {}) {
  const card = document.createElement("article");
  card.className =
    "bg-white/5 border border-white/10 rounded-lg p-3 flex flex-col gap-3";
  card.dataset.attributeCard = "true";

  const options = Array.isArray(attribute.options) ? attribute.options : [];
  const valueType = attribute.value_type || "text";

  card.innerHTML = `
    <div class="flex items-center justify-between gap-3">
      <div class="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Attribute</div>
      <div class="flex items-center gap-1">
        <button type="button" data-action="move-attribute-up" class="px-2 py-1 rounded border border-white/10 bg-black/30 text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors" title="Move up"><i class="ph-bold ph-caret-up"></i></button>
        <button type="button" data-action="move-attribute-down" class="px-2 py-1 rounded border border-white/10 bg-black/30 text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors" title="Move down"><i class="ph-bold ph-caret-down"></i></button>
        <button type="button" data-action="remove-attribute" class="px-2 py-1 rounded border border-red-500/20 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors text-xs font-semibold">Remove</button>
      </div>
    </div>
    <div class="flex gap-2">
      <input type="text" value="${escapeHtml(attribute.name || "")}" data-attribute-name placeholder="Attribute name" class="w-1/2 bg-black/40 border border-white/10 rounded p-1.5 text-xs text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-colors font-mono">
      <select data-value-type class="w-1/2 bg-black/40 border border-white/10 rounded p-1.5 text-xs text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-colors font-mono">
        <option value="text"${valueType === "text" ? " selected" : ""}>Text</option>
        <option value="number"${valueType === "number" ? " selected" : ""}>Number</option>
        <option value="select"${valueType === "select" ? " selected" : ""}>Select</option>
      </select>
    </div>
    <div data-options-panel class="border-l-2 border-white/10 pl-3 ml-2 flex flex-col gap-2">
      <div class="text-[10px] font-mono text-zinc-500">Options</div>
      <div class="flex flex-col gap-2" data-value-list></div>
      <div>
        <button type="button" data-action="add-value" class="px-3 py-1.5 border border-white/10 bg-black/30 hover:bg-white/5 rounded text-xs font-semibold text-zinc-300 transition-colors flex items-center gap-2"><i class="ph-bold ph-plus"></i> Add value</button>
      </div>
    </div>
    <p data-freeform-hint class="text-[10px] text-zinc-500 font-mono">Free-form value entered later on project instances.</p>
  `;

  const valueList = card.querySelector("[data-value-list]");
  if (options.length > 0) {
    options.forEach((option) => {
      valueList.appendChild(buildValueRow(option));
    });
  } else {
    valueList.appendChild(buildValueRow(""));
  }

  toggleValueControls(card);
  return card;
}

function buildValueRow(value = "") {
  const row = document.createElement("div");
  row.className =
    "flex items-center gap-2 bg-black/20 border border-white/10 rounded-lg p-2";
  row.dataset.valueRow = "true";
  row.innerHTML = `
    <button type="button" data-action="move-value-up" class="px-2 py-1 rounded border border-white/10 bg-black/30 text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors" title="Move value up"><i class="ph-bold ph-caret-up"></i></button>
    <button type="button" data-action="move-value-down" class="px-2 py-1 rounded border border-white/10 bg-black/30 text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors" title="Move value down"><i class="ph-bold ph-caret-down"></i></button>
    <input type="text" value="${escapeHtml(value)}" data-value-input placeholder="Option value" class="flex-1 bg-black/40 border border-white/10 rounded p-1.5 text-xs text-zinc-200 focus:outline-none focus:border-accent-500/50 transition-colors font-mono">
    <button type="button" data-action="remove-value" class="px-2 py-1 rounded border border-red-500/20 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors" title="Remove value"><i class="ph-bold ph-x"></i></button>
  `;
  return row;
}

function toggleValueControls(attributeCard) {
  if (!attributeCard) {
    return;
  }
  const valueType = attributeCard.querySelector("[data-value-type]").value;
  const optionsPanel = attributeCard.querySelector("[data-options-panel]");
  const freeformHint = attributeCard.querySelector("[data-freeform-hint]");
  const isSelect = valueType === "select";

  optionsPanel.classList.toggle("hidden", !isSelect);
  freeformHint.classList.toggle("hidden", isSelect);

  if (isSelect) {
    ensureAtLeastOneValueRow(attributeCard);
  }
}

function ensureAtLeastOneValueRow(attributeCard) {
  const valueList = attributeCard.querySelector("[data-value-list]");
  if (!valueList.querySelector("[data-value-row]")) {
    valueList.appendChild(buildValueRow(""));
  }
}

function collectAttributes(list) {
  return Array.from(list.querySelectorAll("[data-attribute-card]"))
    .map((card) => {
      const name = card.querySelector("[data-attribute-name]").value.trim();
      const valueType = card.querySelector("[data-value-type]").value;
      const options =
        valueType === "select"
          ? Array.from(card.querySelectorAll("[data-value-input]"))
              .map((input) => input.value.trim())
              .filter((value) => value !== "")
          : [];
      return {
        name,
        value_type: valueType,
        options,
      };
    })
    .filter((attribute) => attribute.name !== "" || attribute.options.length > 0);
}

function syncEmptyState(list) {
  const existingEmptyState = list.querySelector("[data-empty-state]");
  const hasCards = list.querySelector("[data-attribute-card]");

  if (!hasCards && !existingEmptyState) {
    const emptyState = document.createElement("div");
    emptyState.className =
      "text-zinc-500 font-mono text-xs text-center border border-dashed border-white/10 rounded-lg p-4";
    emptyState.dataset.emptyState = "true";
    emptyState.textContent = "No attributes defined.";
    list.appendChild(emptyState);
  }

  if (hasCards && existingEmptyState) {
    existingEmptyState.remove();
  }
}

function moveElement(element, direction) {
  if (!element || !element.parentElement) {
    return;
  }
  if (direction < 0) {
    const previous = element.previousElementSibling;
    if (previous) {
      element.parentElement.insertBefore(element, previous);
    }
    return;
  }

  const next = element.nextElementSibling;
  if (next) {
    element.parentElement.insertBefore(next, element);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
