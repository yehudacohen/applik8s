import type { ApplicationTypeKroDeclaration } from "@applik8s/deployment-typekro";

export interface TypeKroMaterializationComponent {
  readonly declarations: readonly ApplicationTypeKroDeclaration[];
  readonly orderingOnlyDeclarationIds: readonly string[];
}

/** Preserve canonical TypeKro components while ordering independently compiled bundles. */
export function typeKroMaterializationComponents(
  declarations: readonly ApplicationTypeKroDeclaration[],
): readonly TypeKroMaterializationComponent[] {
  const byId = new Map(declarations.map((declaration) => [declaration.id, declaration]));
  const index = new Map(declarations.map((declaration, position) => [declaration.id, position]));
  const adjacent = new Map(declarations.map((declaration) => [declaration.id, new Set<string>()]));
  for (const declaration of declarations) {
    for (const dependency of [
      ...declaration.dependsOn,
      ...(declaration.schedulingDependsOn ?? []),
    ]) {
      if (!byId.has(dependency)) {
        throw new Error(
          `TypeKro declaration ${declaration.id} has canonical dependency ${dependency} outside its materialization group.`,
        );
      }
      adjacent.get(declaration.id)?.add(dependency);
      adjacent.get(dependency)?.add(declaration.id);
    }
  }

  const componentIds: string[][] = [];
  const componentByDeclaration = new Map<string, number>();
  for (const declaration of declarations) {
    if (componentByDeclaration.has(declaration.id)) continue;
    const componentIndex = componentIds.length;
    const pending = [declaration.id];
    const ids: string[] = [];
    while (pending.length > 0) {
      const id = pending.pop();
      if (!id || componentByDeclaration.has(id)) continue;
      componentByDeclaration.set(id, componentIndex);
      ids.push(id);
      for (const dependency of adjacent.get(id) ?? []) pending.push(dependency);
    }
    ids.sort((left, right) => (index.get(left) ?? 0) - (index.get(right) ?? 0));
    componentIds.push(ids);
  }

  const prerequisites = componentIds.map(() => new Set<number>());
  const orderingIds = componentIds.map(() => new Set<string>());
  for (const declaration of declarations) {
    const target = componentByDeclaration.get(declaration.id);
    if (target === undefined) continue;
    for (const dependency of declaration.orderingOnlyDependsOn ?? []) {
      const source = componentByDeclaration.get(dependency);
      if (source === undefined) {
        throw new Error(
          `TypeKro declaration ${declaration.id} has ordering-only dependency ${dependency} outside its materialization group.`,
        );
      }
      if (source === target) continue;
      prerequisites[target]?.add(source);
      orderingIds[target]?.add(dependency);
    }
  }

  const remaining = new Set(componentIds.map((_, component) => component));
  const ordered: TypeKroMaterializationComponent[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((component) =>
        [...(prerequisites[component] ?? [])].every(
          (dependency) => !remaining.has(dependency),
        ),
      )
      .sort((left, right) => left - right);
    if (ready.length === 0) {
      throw new Error("TypeKro ordering-only declaration components contain a dependency cycle.");
    }
    for (const component of ready) {
      ordered.push({
        declarations: (componentIds[component] ?? [])
          .map((id) => byId.get(id))
          .filter(
            (declaration): declaration is ApplicationTypeKroDeclaration =>
              declaration !== undefined,
          ),
        orderingOnlyDeclarationIds: [...(orderingIds[component] ?? [])].sort(),
      });
      remaining.delete(component);
    }
  }
  return ordered;
}
