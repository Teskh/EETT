from __future__ import annotations

from html import escape


def render_layout(*, title: str, active_nav: str, content: str, extra_scripts: list[str] | None = None) -> str:
    extra_scripts = extra_scripts or []
    nav = [
        _nav_link("/", "Launcher", active_nav == "home"),
        _nav_link("/catalog", "Database Editor", active_nav == "catalog"),
        _nav_link("/projects", "Projects", active_nav == "projects"),
    ]
    scripts = "".join(f'<script src="{escape(path)}" defer></script>' for path in extra_scripts)
    return f"""<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{escape(title)} | Spec Sheets</title>
    <link rel="stylesheet" href="/static/css/app.css">
  </head>
  <body>
    <div class="ambient-glow"></div>
    <div class="page-shell">
      <aside class="rail-nav">
        <div class="rail-brand">SS</div>
        <nav class="rail-links">
          {''.join(nav)}
        </nav>
        <div class="rail-foot">PG</div>
      </aside>
      <section class="workspace-shell">
        <header class="command-bar">
          <div>
            <p class="eyebrow">Spec Sheets Rebuild</p>
            <h1>{escape(title)}</h1>
          </div>
          <div class="command-meta">
            <span class="command-chip">POSTGRES</span>
            <p class="topbar-note">FastAPI + SQLAlchemy, rebuilt as a denser command surface.</p>
          </div>
        </header>
        <main class="page-content">
          {content}
        </main>
      </section>
    </div>
    {scripts}
  </body>
</html>"""


def render_home_page() -> str:
    cards = """
    <section class="hero-grid">
      <article class="hero-card accent-catalog">
        <p class="card-kicker">Central Catalog</p>
        <h2>Database editor views</h2>
        <p>Browse nested categories, inspect reusable item and accessory templates, review attribute definitions, and manage linked accessory categories without the legacy text-field hacks.</p>
        <a class="button-link" href="/catalog">Open database editor</a>
      </article>
      <article class="hero-card accent-projects">
        <p class="card-kicker">Projects</p>
        <h2>Project viewing workspace</h2>
        <p>Open grouped projects, inspect subtype trees, and browse project instances by category with material applicability and BOM state preserved.</p>
        <a class="button-link" href="/projects">Open projects</a>
      </article>
    </section>
    <section class="notes-grid">
      <article class="panel">
        <h3>What is implemented</h3>
        <ul class="clean-list">
          <li>Single normalized schema for categories, components, materials, projects, instances, links, and BOM entries.</li>
          <li>Seeded demo dataset that demonstrates linked accessories, subtype BOM rows, and blank-versus-zero quantity behavior.</li>
          <li>Read-oriented JSON endpoints ready for a later typed React client.</li>
        </ul>
      </article>
      <article class="panel">
        <h3>Current scope</h3>
        <ul class="clean-list">
          <li>Catalog view with lightweight create actions for categories and components.</li>
          <li>Project board with create action and project detail browsing.</li>
          <li>No exports, comments, auth, dashboard, or ERP integration yet.</li>
        </ul>
      </article>
    </section>
    """
    return render_layout(title="Launcher", active_nav="home", content=cards)


def render_catalog_page(data: dict, selected_category_id: int | None) -> str:
    selected = data["selected"]
    summary_cards = "".join(
        f"""
        <article class="metric-card">
          <p>{escape(label)}</p>
          <strong>{value}</strong>
        </article>
        """
        for label, value in (
            ("Categories", data["summary"]["categories"]),
            ("Components", data["summary"]["components"]),
            ("Materials", data["summary"]["materials"]),
        )
    )

    selected_block = "<p class='empty-state'>No category available.</p>"
    if selected is not None:
        child_chips = "".join(
            f'<a class="chip-link" href="/catalog?category_id={child["id"]}">{escape(child["name"])} <span>{escape(child["scope"])}</span></a>'
            for child in selected["child_categories"]
        ) or "<p class='subtle'>This category has no children yet.</p>"
        linked_lines = "".join(
            f"<li>{escape(category['name'])}</li>" for category in selected["linked_categories"]
        ) or "<li>No linked accessory categories configured.</li>"
        component_cards = "".join(_render_catalog_component_card(component) for component in selected["components"]) or "<p class='empty-state'>No components in this category yet.</p>"
        link_checkboxes = "".join(
            f"""
            <label class="checkbox-row">
              <input type="checkbox" name="linked_category_ids" value="{target['id']}" {"checked" if target['id'] in selected['linked_category_ids'] else ""}>
              <span>{escape(target['name'])}</span>
            </label>
            """
            for target in data["link_targets"]
        ) or "<p class='subtle'>No other categories available.</p>"
        selected_block = f"""
        <section class="panel category-detail">
          <div class="panel-header">
            <div>
              <p class="card-kicker">Selected category</p>
              <h2>{escape(selected['name'])}</h2>
            </div>
            <span class="badge badge-scope">{escape(selected['scope'])}</span>
          </div>
          <p>{escape(selected['description'] or 'No description yet.')}</p>
          <div class="inline-grid two-col">
            <div>
              <h3>Child categories</h3>
              <div class="chip-stack">{child_chips}</div>
            </div>
            <div>
              <h3>Linked accessory categories</h3>
              <ul class="clean-list">{linked_lines}</ul>
            </div>
          </div>
        </section>
        <section class="inline-grid two-col">
          <form class="panel form-panel" method="post" action="/catalog/categories">
            <h3>Add child category</h3>
            <input type="hidden" name="parent_id" value="{selected['id']}">
            <label>Name<input name="name" required></label>
            <label>Description<textarea name="description" rows="3"></textarea></label>
            <label>Scope
              <select name="scope">
                <option value="item">Item</option>
                <option value="accessory">Accessory</option>
                <option value="mixed">Mixed</option>
              </select>
            </label>
            <button class="button-link" type="submit">Create category</button>
          </form>
          <form class="panel form-panel" method="post" action="/catalog/components">
            <h3>Add component</h3>
            <input type="hidden" name="category_id" value="{selected['id']}">
            <label>Name<input name="name" required></label>
            <label>Short name<input name="short_name"></label>
            <label>Type
              <select name="component_type">
                <option value="item">Item</option>
                <option value="accessory">Accessory</option>
              </select>
            </label>
            <label>Unit type<input name="unit_type" placeholder="unit, m2, set..."></label>
            <label>Description<textarea name="description" rows="4"></textarea></label>
            <label>Installation<textarea name="installation" rows="3"></textarea></label>
            <button class="button-link" type="submit">Create component</button>
          </form>
        </section>
        <form class="panel form-panel link-form" method="post" action="/catalog/categories/{selected['id']}/links">
          <h3>Linked category rules</h3>
          <p class="subtle">These explicit relationships replace the legacy comma-separated linked category field.</p>
          <div class="checkbox-grid">
            {link_checkboxes}
          </div>
          <button class="button-link secondary" type="submit">Save link rules</button>
        </form>
        <section class="stacked-list">
          <div class="section-title">
            <h3>Components in {escape(selected['name'])}</h3>
            <p>{len(selected['components'])} reusable template(s)</p>
          </div>
          {component_cards}
        </section>
        """

    content = f"""
    <section class="inline-grid three-col hero-strip">
      {summary_cards}
    </section>
    <section class="workspace">
      <aside class="sidebar panel">
        <div class="sidebar-head">
          <p class="card-kicker">Category tree</p>
          <input id="catalogTreeSearch" type="search" placeholder="Filter categories">
        </div>
        <div class="tree-root" data-tree-filter-target>
          {_render_catalog_tree(data['tree'], selected_category_id or (selected['id'] if selected else None))}
        </div>
      </aside>
      <section class="workspace-main">
        {selected_block}
      </section>
    </section>
    """
    return render_layout(
        title="Database Editor",
        active_nav="catalog",
        content=content,
        extra_scripts=["/static/js/catalog.js"],
    )


def render_projects_page(data: dict) -> str:
    columns = []
    ordered_statuses = ["template", "execution", "finished"]
    for status in ordered_statuses:
        cards = "".join(
            f"""
            <article class="project-card">
              <div>
                <p class="project-name">{escape(project['name'])}</p>
                <p class="subtle">{escape(project['description'] or 'No description.')}</p>
              </div>
              <div class="project-meta">
                <span>{project['instance_count']} instances</span>
                <span>Updated {escape(project['updated_at'])}</span>
              </div>
              <a class="button-link secondary" href="/projects/{project['id']}">Open project</a>
            </article>
            """
            for project in data["grouped_projects"][status]
        ) or "<p class='empty-state'>No projects in this status.</p>"
        columns.append(
            f"""
            <section class="panel status-column">
              <div class="panel-header compact">
                <div>
                  <p class="card-kicker">Lifecycle</p>
                  <h2>{escape(data['status_labels'][status])}</h2>
                </div>
                <span class="badge">{len(data['grouped_projects'][status])}</span>
              </div>
              <div class="stacked-list">{cards}</div>
            </section>
            """
        )

    content = f"""
    <section class="inline-grid three-col">
      <form class="panel form-panel" method="post" action="/projects">
        <h2>Create project</h2>
        <label>Name<input name="name" required></label>
        <label>Status
          <select name="status">
            <option value="template">Project Template</option>
            <option value="execution">Execution Project</option>
            <option value="finished">Finished Project</option>
          </select>
        </label>
        <label>Description<textarea name="description" rows="4"></textarea></label>
        <button class="button-link" type="submit">Create project</button>
      </form>
      <article class="panel info-card span-two">
        <p class="card-kicker">Project board</p>
        <h2>Project lifecycle preserved</h2>
        <p>The legacy statuses remain explicit domain states. The viewer workspace keeps templates, execution projects, and finished work together in one model while still allowing status-based browsing.</p>
      </article>
    </section>
    <section class="inline-grid three-col status-grid">
      {''.join(columns)}
    </section>
    """
    return render_layout(title="Projects", active_nav="projects", content=content)


def render_project_detail_page(data: dict) -> str:
    project = data["project"]
    sections = []
    category_links = []
    for category in data["categories"]:
        category_links.append(
            f'<a href="#category-{category["id"]}" class="sidebar-link" data-category-link>{("&nbsp;" * category["depth"] * 2)}{escape(category["name"])}</a>'
        )
        component_options = "".join(
            f'<option value="{component["id"]}" data-name="{escape(component["name"])}" data-short-name="{escape(component["short_name"] or "")}" data-description="{escape(component["description"] or "")}" data-installation="{escape(component["installation"] or "")}">{escape(component["name"])} ({escape(component["type"])})</option>'
            for component in category["available_components"]
        )
        create_instance_modal = _render_create_instance_modal(project["id"], category, component_options) if category["available_components"] else ""
        create_instance_action = (
            f'<button type="button" class="button-link secondary" data-modal-open="add-instance-{category["id"]}">Add instance</button>'
            if category["available_components"]
            else "<p class='subtle'>No reusable components exist in this category yet.</p>"
        )
        instance_cards = "".join(
            _render_project_instance(project["id"], category["id"], instance)
            for instance in category["instances"]
        ) or "<p class='empty-state'>No project instances in this category yet.</p>"
        linked_categories = "".join(
            f'<span class="badge">{escape(name)}</span>' for name in category["linked_categories"]
        ) or "<span class='subtle'>No linked accessory targets.</span>"
        sections.append(
            f"""
            <section id="category-{category['id']}" class="panel category-section depth-{category['depth']}">
              <div class="panel-header compact">
                <div>
                  <p class="card-kicker">Category</p>
                  <h2>{escape(category['name'])}</h2>
                </div>
                <span class="badge badge-scope">{escape(category['scope'])}</span>
              </div>
              <div class="linked-row">
                <strong>Linked accessory categories:</strong> {linked_categories}
              </div>
              <div class="category-actions">
                {create_instance_action}
              </div>
              {create_instance_modal}
              <div class="stacked-list">{instance_cards}</div>
            </section>
            """
        )

    subtype_tree = "".join(_render_subtype(subtype) for subtype in data["subtypes"]) or "<li>No subtype breakdown defined.</li>"
    auxiliary_rows = "".join(
        f"""
        <tr>
          <td>{escape(row['code'])}</td>
          <td>{escape(row['name'])}</td>
          <td>{escape(row['category'] or 'Uncategorized')}</td>
          <td>{escape(row['subtype'])}</td>
          <td>{row['price']:,.0f}</td>
        </tr>
        """
        for row in data["auxiliary_materials"]
    ) or "<tr><td colspan='5'>No auxiliary materials selected.</td></tr>"

    content = f"""
    <section class="project-hero panel">
      <div>
        <p class="card-kicker">Project viewer</p>
        <h2>{escape(project['name'])}</h2>
        <p>{escape(project['description'] or 'No description.')}</p>
      </div>
      <div class="hero-meta">
        <span class="badge">{escape(project['status_label'])}</span>
        <span>{project['instance_count']} project instances</span>
      </div>
    </section>
    <section class="workspace project-workspace">
      <aside class="sidebar panel">
        <div class="sidebar-head">
          <p class="card-kicker">Jump to category</p>
          <input id="projectCategorySearch" type="search" placeholder="Filter categories">
        </div>
        <div class="sidebar-links" data-tree-filter-target>
          {''.join(category_links)}
        </div>
        <div class="subtypes-block">
          <h3>Subtype tree</h3>
          <ul class="tree-list">{subtype_tree}</ul>
        </div>
      </aside>
      <section class="workspace-main">
        {''.join(sections)}
        <section class="panel">
          <div class="panel-header compact">
            <div>
              <p class="card-kicker">Auxiliary materials</p>
              <h2>Project-level selections</h2>
            </div>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Category</th>
                <th>Subtype</th>
                <th>Base price</th>
              </tr>
            </thead>
            <tbody>{auxiliary_rows}</tbody>
          </table>
        </section>
      </section>
    </section>
    """
    return render_layout(
        title=project["name"],
        active_nav="projects",
        content=content,
        extra_scripts=["/static/js/project_view.js"],
    )


def _render_catalog_tree(nodes: list[dict], selected_category_id: int | None) -> str:
    if not nodes:
        return "<p class='empty-state'>No categories loaded.</p>"
    return "<ul class='tree-list'>" + "".join(_render_catalog_tree_node(node, selected_category_id) for node in nodes) + "</ul>"


def _render_catalog_tree_node(node: dict, selected_category_id: int | None) -> str:
    active = "active" if node["id"] == selected_category_id else ""
    children = _render_catalog_tree(node["children"], selected_category_id) if node["children"] else ""
    return f"""
    <li data-filter-item>
      <a class="tree-link {active}" href="/catalog?category_id={node['id']}">
        <span>{escape(node['name'])}</span>
        <small>{node['component_count']} comps</small>
      </a>
      {children}
    </li>
    """


def _render_catalog_component_card(component: dict) -> str:
    attributes = "".join(
        f"""
        <li>
          <strong>{escape(attribute['name'])}</strong>
          <span>{escape(attribute['value_type'])}</span>
          <p>{escape(', '.join(attribute['options']) if attribute['options'] else 'Free value')}</p>
        </li>
        """
        for attribute in component["attributes"]
    ) or "<li>No attributes defined.</li>"

    material_rows = "".join(_render_material_rule(rule) for rule in component["material_rules"]) or "<p class='empty-state'>No material rules defined.</p>"
    return f"""
    <article class="panel component-card">
      <div class="panel-header compact">
        <div>
          <p class="card-kicker">{escape(component['type'])}</p>
          <h4>{escape(component['name'])}</h4>
        </div>
        <span class="badge">{escape(component['short_name'] or component['name'])}</span>
      </div>
      <p>{escape(component['description'] or 'No description yet.')}</p>
      <div class="inline-grid two-col">
        <div>
          <h5>Attributes</h5>
          <ul class="attribute-list">{attributes}</ul>
        </div>
        <div>
          <h5>Material rules</h5>
          <div class="stacked-list">{material_rows}</div>
        </div>
      </div>
      <div class="inline-grid two-col component-crud">
        <form class="form-panel compact-form" method="post" action="/catalog/components/{component['id']}/update">
          <h5>Edit component</h5>
          <label>Name<input name="name" value="{escape(component['name'])}" required></label>
          <label>Short name<input name="short_name" value="{escape(component['short_name'] or '')}"></label>
          <label>Type
            <select name="component_type">
              <option value="item" {"selected" if component['type'] == 'item' else ""}>Item</option>
              <option value="accessory" {"selected" if component['type'] == 'accessory' else ""}>Accessory</option>
            </select>
          </label>
          <label>Unit type<input name="unit_type" value="{escape(component['unit_type'] or '')}"></label>
          <label>Description<textarea name="description" rows="3">{escape(component['description'] or '')}</textarea></label>
          <label>Installation<textarea name="installation" rows="3">{escape(component['installation'] or '')}</textarea></label>
          <button class="button-link secondary" type="submit">Save changes</button>
        </form>
        <form class="form-panel compact-form danger-form" method="post" action="/catalog/components/{component['id']}/delete">
          <h5>Delete component</h5>
          <input type="hidden" name="category_id" value="{component['category_id']}">
          <p class="subtle">Deletion is blocked once a reusable component is already used in a project.</p>
          <button class="button-link danger" type="submit">Delete component</button>
        </form>
      </div>
    </article>
    """


def _render_material_rule(rule: dict) -> str:
    conditions = []
    for group in rule["conditions"]:
        clauses = " AND ".join(
            _format_condition(clause)
            for clause in group["clauses"]
        )
        conditions.append(f"<li>{escape(group['group'])}: {escape(clauses)}</li>")
    condition_list = "".join(conditions) if conditions else "<li>Always applies</li>"
    unit_qty = "n/a" if rule["unit_qty_per_unit"] is None else f"{rule['unit_qty_per_unit']}"
    return f"""
    <article class="material-rule">
      <div class="material-rule-head">
        <strong>{escape(rule['material_name'])}</strong>
        <span>{escape(rule['sku'])}</span>
      </div>
      <p>{escape(rule['notes'] or 'No notes.')}</p>
      <p class="subtle">Unit: {escape(rule['unit'] or '-')} | Qty per unit: {escape(unit_qty)}</p>
      <ul class="clean-list">{condition_list}</ul>
    </article>
    """


def _render_project_instance(project_id: int, category_id: int, instance: dict) -> str:
    attribute_blocks = "".join(
        f"""
        <article class="attribute-group">
          <h5>{escape(group['name'])}</h5>
          <p class="subtle">{escape(group['application_label'] or 'Base attributes')}</p>
          <dl class="attribute-grid">
            {''.join(f'<div><dt>{escape(row["name"])}</dt><dd>{escape(row["value"] or "-")}</dd></div>' for row in group['values'])}
          </dl>
        </article>
        """
        for group in instance["attributes"]
    ) or "<p class='empty-state'>No attributes loaded.</p>"

    linked_accessories = "".join(
        _render_instance_link_badge(link) for link in instance["linked_accessories"]
    ) or "<span class='subtle'>None</span>"
    linked_to = "".join(
        _render_instance_link_badge(link) for link in instance["linked_to"]
    ) or "<span class='subtle'>Standalone</span>"
    material_rows = "".join(_render_bom_material(material) for material in instance["materials"]) or "<p class='empty-state'>No applicable materials resolved for this instance.</p>"
    edit_modal = _render_edit_instance_modal(project_id, category_id, instance)

    return f"""
    <article class="instance-card">
      <div class="panel-header compact">
        <div>
          <p class="card-kicker">{escape(instance['type'])}</p>
          <h3>{escape(instance['name'])}</h3>
        </div>
        <div class="instance-card-actions">
          <span class="badge">{escape(instance['short_name'] or instance['name'])}</span>
          <button type="button" class="button-link secondary" data-modal-open="edit-instance-{instance['id']}">Edit</button>
          <form method="post" action="/projects/{project_id}/instances/{instance['id']}/delete" onsubmit="return confirm('Delete this project instance and its project-scoped records?');">
            <input type="hidden" name="category_id" value="{category_id}">
            <button class="button-link danger" type="submit">Delete</button>
          </form>
        </div>
      </div>
      <p>{escape(instance['description'] or 'No description yet.')}</p>
      <p class="subtle">Unit amount: {escape(str(instance['unit_amount']) if instance['unit_amount'] is not None else '-')}</p>
      <p class="subtle">Sync state: {escape(instance['sync_state']['status'])}</p>
      <div class="inline-grid two-col">
        <div>
          <h4>Attributes</h4>
          {attribute_blocks}
        </div>
        <div>
          <h4>Relationships</h4>
          <p><strong>Linked accessories:</strong> {linked_accessories}</p>
          <p><strong>Attached to:</strong> {linked_to}</p>
          <h4>Installation</h4>
          <p>{escape(instance['installation'] or 'No installation notes.')}</p>
        </div>
      </div>
      <div class="materials-table">
        <h4>Applicable materials</h4>
        {material_rows}
      </div>
    </article>
    {edit_modal}
    """


def _render_instance_link_badge(link: dict) -> str:
    label = escape(link["name"])
    if link.get("application_label"):
        label = f"{label} · {escape(link['application_label'])}"
    return f'<span class="badge">{label}</span>'


def _render_create_instance_modal(project_id: int, category: dict, component_options: str) -> str:
    return f"""
    <div class="modal-shell" data-modal="add-instance-{category['id']}" aria-hidden="true">
      <div class="modal-backdrop" data-modal-close></div>
      <section class="modal-card">
        <div class="panel-header compact">
          <div>
            <p class="card-kicker">Create project instance</p>
            <h3>{escape(category['name'])}</h3>
          </div>
          <button type="button" class="button-link secondary" data-modal-close>Close</button>
        </div>
        <form class="form-panel compact-form" method="post" action="/projects/{project_id}/instances" data-component-prefill-form>
          <input type="hidden" name="category_id" value="{category['id']}">
          <label>Template component
            <select name="component_id" required data-component-select>
              {component_options}
            </select>
          </label>
          <label>Instance name<input name="name" required data-prefill-target="name"></label>
          <label>Short name<input name="short_name" data-prefill-target="short_name"></label>
          <label>Unit amount<input name="unit_amount" placeholder="Optional quantity basis"></label>
          <label>Description<textarea name="description" rows="3" data-prefill-target="description"></textarea></label>
          <label>Installation<textarea name="installation" rows="3" data-prefill-target="installation"></textarea></label>
          <div class="modal-actions">
            <button type="button" class="button-link secondary" data-modal-close>Cancel</button>
            <button class="button-link" type="submit">Create instance</button>
          </div>
        </form>
      </section>
    </div>
    """


def _render_edit_instance_modal(project_id: int, category_id: int, instance: dict) -> str:
    return f"""
    <div class="modal-shell" data-modal="edit-instance-{instance['id']}" aria-hidden="true">
      <div class="modal-backdrop" data-modal-close></div>
      <section class="modal-card">
        <div class="panel-header compact">
          <div>
            <p class="card-kicker">Edit project instance</p>
            <h3>{escape(instance['name'])}</h3>
          </div>
          <button type="button" class="button-link secondary" data-modal-close>Close</button>
        </div>
        <form class="form-panel compact-form" method="post" action="/projects/{project_id}/instances/{instance['id']}/update">
          <input type="hidden" name="category_id" value="{category_id}">
          <label>Name<input name="name" value="{escape(instance['name'])}" required></label>
          <label>Short name<input name="short_name" value="{escape(instance['short_name'] or '')}"></label>
          <label>Unit amount<input name="unit_amount" value="{escape(str(instance['unit_amount']) if instance['unit_amount'] is not None else '')}"></label>
          <label>Description<textarea name="description" rows="4">{escape(instance['description'] or '')}</textarea></label>
          <label>Installation<textarea name="installation" rows="4">{escape(instance['installation'] or '')}</textarea></label>
          <p class="subtle">Saving marks this snapshot as customized. Use refresh if you want to pull catalog data forward instead.</p>
          <div class="modal-actions">
            <button type="button" class="button-link secondary" data-modal-close>Cancel</button>
            <button class="button-link" type="submit">Save instance</button>
          </div>
        </form>
      </section>
    </div>
    """


def _render_bom_material(material: dict) -> str:
    bom_rows = "".join(
        f"""
        <tr class="{_quantity_class(row['quantity'])}">
          <td>{escape(row['subtype'])}</td>
          <td>{_format_quantity(row['quantity'])}</td>
          <td>{_format_quantity(row['assembly_quantity'])}</td>
          <td>{escape(row['unit'] or '-')}</td>
          <td>{escape(row['calculation_mode'])}</td>
          <td>{escape(row['calculation_formula'] or '-')}</td>
        </tr>
        """
        for row in material["bom_entries"]
    ) or "<tr><td colspan='6'>Applicable, but no BOM row stored yet.</td></tr>"
    return f"""
    <article class="material-card">
      <div class="material-rule-head">
        <strong>{escape(material['material_name'])}</strong>
        <span>{escape(material['sku'])}</span>
      </div>
      <p class="subtle">Rule qty per unit: {escape(str(material['unit_qty_per_unit']) if material['unit_qty_per_unit'] is not None else '-')} {escape(material['unit'] or '-')}</p>
      <p>{escape(material['notes'] or 'No notes.')}</p>
      <table class="data-table compact">
        <thead>
          <tr>
            <th>Subtype</th>
            <th>Quantity</th>
            <th>Assembly kit</th>
            <th>Unit</th>
            <th>Source</th>
            <th>Formula</th>
          </tr>
        </thead>
        <tbody>{bom_rows}</tbody>
      </table>
      <p class="legend-note">Blank quantity means applicable but not quantified yet. Zero means intentionally suppressed.</p>
    </article>
    """


def _render_subtype(subtype: dict) -> str:
    children = "".join(_render_subtype(child) for child in subtype["children"])
    child_block = f"<ul>{children}</ul>" if children else ""
    return f"<li>{escape(subtype['name'])}{child_block}</li>"


def _nav_link(href: str, label: str, active: bool) -> str:
    classes = "nav-link active" if active else "nav-link"
    short = "".join(part[0] for part in label.split()[:2]).upper()
    return f'<a class="{classes}" href="{href}"><span class="nav-short">{escape(short)}</span><span class="nav-label">{escape(label)}</span></a>'


def _format_condition(clause: dict) -> str:
    right_side = clause["comparison_value"] or ""
    if clause["comparison_value_secondary"]:
        right_side = f"{right_side} and {clause['comparison_value_secondary']}"
    return f"{clause['attribute_name']} {clause['operator']} {right_side}".strip()


def _quantity_class(value: float | None) -> str:
    if value is None:
        return "qty-blank"
    if value == 0:
        return "qty-zero"
    return "qty-normal"


def _format_quantity(value: float | None) -> str:
    if value is None:
        return ""
    if float(value).is_integer():
        return str(int(value))
    return f"{value:.2f}"
