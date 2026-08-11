export type SearchTreeNode<TNode> = {
  children: TNode[];
};

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();
}

export function matchesSearchText(term: string, ...values: Array<string | null | undefined>): boolean {
  const normalizedTerm = normalizeSearchText(term);
  if (!normalizedTerm) {
    return true;
  }
  return values.some((value) => normalizeSearchText(value || "").includes(normalizedTerm));
}

export function searchTreeBranchMatches<TNode extends SearchTreeNode<TNode>>(
  node: TNode,
  term: string,
  getSearchableValues: (node: TNode) => Array<string | null | undefined>,
): boolean {
  return (
    matchesSearchText(term, ...getSearchableValues(node)) ||
    node.children.some((child) => searchTreeBranchMatches(child, term, getSearchableValues))
  );
}
