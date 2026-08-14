import type { MaterialDashboardCeco } from "../../lib/types";

export type CecoTreeNode = MaterialDashboardCeco & {
  children: CecoTreeNode[];
  leafCodes: string[];
};

export type CecoSelectionState = "checked" | "mixed" | "unchecked";

function inferLevel(code: string, level: number | undefined) {
  if (level === 1 || level === 2 || level === 3) {
    return level;
  }
  const parts = code.split("-");
  if (parts.length === 3 && parts[1] === "00" && parts[2] === "00") {
    return 1;
  }
  if (parts.length === 3 && parts[2] === "00") {
    return 2;
  }
  return 3;
}

function inferParentCode(code: string, level: number) {
  const parts = code.split("-");
  if (level <= 1 || parts.length !== 3) {
    return null;
  }
  return level === 2 ? `${parts[0]}-00-00` : `${parts[0]}-${parts[1]}-00`;
}

function compareNodes(left: CecoTreeNode, right: CecoTreeNode) {
  return left.code.localeCompare(right.code, undefined, { numeric: true });
}

export function buildCecoTree(cecos: MaterialDashboardCeco[]): CecoTreeNode[] {
  const nodes = new Map<string, CecoTreeNode>();
  for (const ceco of cecos) {
    const level = inferLevel(ceco.code, ceco.level);
    nodes.set(ceco.code, {
      ...ceco,
      level,
      parent_code: ceco.parent_code ?? inferParentCode(ceco.code, level),
      active: ceco.active !== false,
      children: [],
      leafCodes: [],
    });
  }

  const roots: CecoTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_code ? nodes.get(node.parent_code) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  function assignLeafCodes(node: CecoTreeNode) {
    node.children.sort(compareNodes);
    if (!node.children.length || node.level >= 3) {
      node.leafCodes = [node.code];
      return node.leafCodes;
    }
    node.leafCodes = node.children.flatMap(assignLeafCodes);
    return node.leafCodes;
  }

  roots.sort(compareNodes);
  roots.forEach(assignLeafCodes);
  return roots;
}

export function filterCecoTree(nodes: CecoTreeNode[], rawTerm: string): CecoTreeNode[] {
  const term = rawTerm.trim().toLowerCase();
  if (!term) {
    return nodes;
  }

  return nodes.flatMap((node) => {
    const matches = node.code.toLowerCase().includes(term) || node.name.toLowerCase().includes(term);
    const matchingChildren = filterCecoTree(node.children, term);
    if (!matches && !matchingChildren.length) {
      return [];
    }
    return [{ ...node, children: matches ? node.children : matchingChildren }];
  });
}

export function expandCecoSelections(nodes: CecoTreeNode[], selectedCodes: string[]) {
  const byCode = new Map<string, CecoTreeNode>();
  function visit(node: CecoTreeNode) {
    byCode.set(node.code, node);
    node.children.forEach(visit);
  }
  nodes.forEach(visit);

  const leafCodes = new Set<string>();
  for (const code of selectedCodes) {
    const node = byCode.get(code);
    if (node) {
      node.leafCodes.forEach((leafCode) => leafCodes.add(leafCode));
    } else {
      leafCodes.add(code);
    }
  }
  return Array.from(leafCodes).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

export function compressCecoSelections(nodes: CecoTreeNode[], selectedLeafCodes: string[]) {
  const selected = new Set(selectedLeafCodes);
  const result: string[] = [];
  const knownLeafCodes = new Set<string>();

  function visit(node: CecoTreeNode) {
    node.leafCodes.forEach((code) => knownLeafCodes.add(code));
    const selectedCount = node.leafCodes.reduce((count, code) => count + (selected.has(code) ? 1 : 0), 0);
    if (selectedCount === 0) {
      return;
    }
    if (selectedCount === node.leafCodes.length) {
      result.push(node.code);
      return;
    }
    node.children.forEach(visit);
  }

  nodes.forEach(visit);
  selectedLeafCodes.forEach((code) => {
    if (!knownLeafCodes.has(code)) {
      result.push(code);
    }
  });
  return result.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

export function getCecoSelectionState(node: CecoTreeNode, selectedLeafCodes: ReadonlySet<string>): CecoSelectionState {
  const selectedCount = node.leafCodes.reduce((count, code) => count + (selectedLeafCodes.has(code) ? 1 : 0), 0);
  if (selectedCount === 0) {
    return "unchecked";
  }
  if (selectedCount === node.leafCodes.length) {
    return "checked";
  }
  return "mixed";
}

export function collectExpandableCecoCodes(nodes: CecoTreeNode[]) {
  const codes: string[] = [];
  function visit(node: CecoTreeNode) {
    if (node.children.length) {
      codes.push(node.code);
      node.children.forEach(visit);
    }
  }
  nodes.forEach(visit);
  return codes;
}

