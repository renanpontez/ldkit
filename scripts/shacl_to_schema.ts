import { Parser, type Quad, Store, type Term } from "npm:n3@^1.26.0";

import {
  type ExtraNamespace,
  type PropertySpec,
  type SchemaSpec,
} from "./schema_to_script.ts";

// Built-in LDkit namespaces — prefixes declared in the SHACL whose base IRI
// matches one of these EXACTLY will NOT be re-emitted as createNamespace()
// calls (the printer falls back on the built-in import). IRIs must match
// LDkit's built-ins verbatim — `https://schema.org/` is NOT here because
// LDkit's `schema` namespace uses `http://schema.org/`, so they are distinct
// and must each get their own declaration to avoid mismatched query IRIs.
// Keep in sync with `NAMESPACES` in schema_to_script.ts.
const BUILTIN_NAMESPACE_IRIS = new Set([
  "http://dbpedia.org/ontology/",
  "http://purl.org/dc/elements/1.1/",
  "http://purl.org/dc/terms/",
  "http://xmlns.com/foaf/0.1/",
  "http://purl.org/goodrelations/v1#",
  "https://ldkit.io/ontology/",
  "http://www.w3.org/2002/07/owl#",
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  "http://www.w3.org/2000/01/rdf-schema#",
  "http://schema.org/",
  "http://rdfs.org/sioc/ns#",
  "http://www.w3.org/2004/02/skos/core#",
  "http://www.w3.org/2001/XMLSchema#",
]);

// LDkit's built-in namespace prefix names. If a user-declared SHACL prefix
// uses the same name with a *different* IRI, we rename to avoid colliding
// with the `import { ... } from "ldkit/namespaces"` line.
const BUILTIN_NAMESPACE_PREFIXES = new Set([
  "dbo",
  "dc",
  "dcterms",
  "foaf",
  "gr",
  "ldkit",
  "owl",
  "rdf",
  "rdfs",
  "schema",
  "sioc",
  "skos",
  "xsd",
]);

const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const SH = "http://www.w3.org/ns/shacl#";

const RDF_TYPE = `${RDF}type`;
const RDF_FIRST = `${RDF}first`;
const RDF_REST = `${RDF}rest`;
const RDF_NIL = `${RDF}nil`;
const RDF_LANG_STRING = `${RDF}langString`;
const XSD_STRING = `${XSD}string`;
const RDFS_CLASS = `${RDFS}Class`;

const SH_NODE_SHAPE = `${SH}NodeShape`;
const SH_TARGET_CLASS = `${SH}targetClass`;
const SH_PROPERTY = `${SH}property`;
const SH_PATH = `${SH}path`;
const SH_INVERSE_PATH = `${SH}inversePath`;
const SH_DATATYPE = `${SH}datatype`;
const SH_NODE_KIND = `${SH}nodeKind`;
const SH_IRI = `${SH}IRI`;
const SH_NODE = `${SH}node`;
const SH_CLASS = `${SH}class`;
const SH_MIN_COUNT = `${SH}minCount`;
const SH_MAX_COUNT = `${SH}maxCount`;
const SH_UNIQUE_LANG = `${SH}uniqueLang`;
const SH_AND = `${SH}and`;
const SH_OR = `${SH}or`;
const SH_IN = `${SH}in`;

// Numeric widening order: leftmost = widest. Used to reduce sh:or alternatives
// like (xsd:decimal | xsd:double | xsd:integer) to a single TS-compatible type.
const NUMERIC_WIDENING = [
  `${XSD}decimal`,
  `${XSD}double`,
  `${XSD}float`,
  `${XSD}long`,
  `${XSD}integer`,
  `${XSD}int`,
  `${XSD}short`,
  `${XSD}byte`,
  `${XSD}nonNegativeInteger`,
  `${XSD}positiveInteger`,
  `${XSD}unsignedLong`,
  `${XSD}unsignedInt`,
];

type Constraints = {
  datatype?: string;
  nodeKind?: string;
  refNode?: string;
  refClass?: string;
  uniqueLang?: boolean;
  inFirstType?: string; // type derived from sh:in's first list element
};

type ReducedOr =
  | { kind: "datatype"; value: string }
  | { kind: "iri" }
  | { kind: "untyped" };

export type ShaclConversionResult = {
  schemas: SchemaSpec[];
  extraNamespaces: ExtraNamespace[];
};

export function shaclToSchema(turtle: string): ShaclConversionResult {
  const converter = new ShaclConverter();
  return converter.process(turtle);
}

function mergePropertySpecs(a: PropertySpec, b: PropertySpec): PropertySpec {
  // SHACL "AND of property shapes" semantics:
  // - type / schemaRef: last-wins for conflicts (rare in practice)
  // - optional / array: AND — only loose if BOTH branches are loose, since the
  //   stricter branch's cardinality dominates (e.g. one branch with maxCount=1
  //   makes the property non-array regardless of what other branches say)
  // - multilang / inverse: OR — these are intrinsic to the path, not loosened
  const merged: PropertySpec = { id: a.id };
  if (b.type !== undefined) merged.type = b.type;
  else if (a.type !== undefined) merged.type = a.type;
  if (b.schemaRef !== undefined) merged.schemaRef = b.schemaRef;
  else if (a.schemaRef !== undefined) merged.schemaRef = a.schemaRef;
  if (a.optional && b.optional) merged.optional = true;
  if (a.array && b.array) merged.array = true;
  if (a.multilang || b.multilang) merged.multilang = true;
  if (a.inverse || b.inverse) merged.inverse = true;
  return merged;
}

class ShaclConverter {
  private store!: Store;
  private schemas: SchemaSpec[] = [];
  private shapeIriToName = new Map<string, string>();
  private classIriToSchemaName = new Map<string, string>();
  private usedNames = new Set<string>();
  private prefixMap: Record<string, string> = {};

  public process(turtle: string): ShaclConversionResult {
    this.parseWithPrefixes(turtle);

    const shapeIris = this.findNodeShapes();

    for (const shapeIri of shapeIris) {
      const name = this.deriveSchemaName(shapeIri);
      this.shapeIriToName.set(shapeIri, name);
    }

    for (const shapeIri of shapeIris) {
      const schema = this.buildSchema(shapeIri);
      this.schemas.push(schema);
    }

    return {
      schemas: this.schemas,
      extraNamespaces: this.deriveExtraNamespaces(),
    };
  }

  /**
   * Use the n3 Parser's streaming callback API to capture both the quads and
   * the `@prefix` declarations from the source Turtle. The synchronous
   * `parser.parse(turtle)` overload returns only quads — we want the prefix
   * map so we can re-emit user-defined vocabularies as `createNamespace()`
   * declarations in the generated TS.
   */
  private parseWithPrefixes(turtle: string): void {
    // Parse the quads synchronously (n3's streaming callback form is
    // asynchronous and would race the rest of process()).
    const parser = new Parser();
    this.store = new Store(parser.parse(turtle));

    // Extract `@prefix` declarations directly from the source. The Turtle
    // grammar guarantees the form `@prefix name: <iri> .` (case-insensitive
    // for the `@prefix` keyword, with optional whitespace), so a simple
    // regex is sufficient and avoids the streaming-callback complexity.
    const prefixRe =
      /@prefix\s+([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*<([^>]+)>\s*\./g;
    for (const match of turtle.matchAll(prefixRe)) {
      const [, prefix, iri] = match;
      this.prefixMap[prefix] = iri;
    }
  }

  /**
   * From all `@prefix` declarations seen in the input, keep only those whose
   * base IRI is NOT already a built-in LDkit namespace AND whose IRI is
   * actually used by something in the generated schemas. Each one becomes a
   * `createNamespace()` block in the generated TS.
   */
  private deriveExtraNamespaces(): ExtraNamespace[] {
    const usedIris = new Set<string>();
    for (const schema of this.schemas) {
      for (const t of schema.type) usedIris.add(t);
      for (const prop of Object.values(schema.properties)) {
        usedIris.add(prop.id);
        if (prop.type) usedIris.add(prop.type);
      }
    }

    const result: ExtraNamespace[] = [];
    const seenIris = new Set<string>();
    const usedNames = new Set<string>();
    for (const [prefix, iri] of Object.entries(this.prefixMap)) {
      if (BUILTIN_NAMESPACE_IRIS.has(iri)) continue;
      if (seenIris.has(iri)) continue; // first prefix declared wins
      const isUsed = [...usedIris].some((u) => u.startsWith(iri));
      if (!isUsed) continue;
      seenIris.add(iri);
      // Avoid colliding with built-in namespace prefix imports — e.g. a user
      // `@prefix schema: <https://schema.org/>` (HTTPS) would otherwise clash
      // with `import { schema } from "ldkit/namespaces"` (HTTP). Suffix `_`
      // until unique among both built-ins and previously-emitted extras.
      let safeName = prefix;
      while (
        BUILTIN_NAMESPACE_PREFIXES.has(safeName) || usedNames.has(safeName)
      ) {
        safeName += "_";
      }
      usedNames.add(safeName);
      result.push({ iri, prefix: safeName });
    }
    return result;
  }

  private findNodeShapes(): string[] {
    const quads = this.store.getQuads(null, RDF_TYPE, SH_NODE_SHAPE, null);
    const iris: string[] = [];
    for (const q of quads) {
      if (q.subject.termType === "NamedNode") {
        iris.push(q.subject.value);
      }
    }
    return iris;
  }

  private deriveSchemaName(shapeIri: string): string {
    const targetClass = this.getObjectIri(shapeIri, SH_TARGET_CLASS);
    const baseIri = targetClass ?? shapeIri;
    let local = this.getSuffix(baseIri);
    if (!targetClass && local.endsWith("Shape")) {
      local = local.substring(0, local.length - "Shape".length);
    }
    return this.uniqueName(
      `${this.capitalize(this.sanitizeIdentifier(local))}Schema`,
    );
  }

  private uniqueName(name: string): string {
    if (!this.usedNames.has(name)) {
      this.usedNames.add(name);
      return name;
    }
    for (let i = 1; i < 1000; i++) {
      const candidate = `${name}${i}`;
      if (!this.usedNames.has(candidate)) {
        this.usedNames.add(candidate);
        return candidate;
      }
    }
    throw new Error(`Could not generate a unique name for ${name}`);
  }

  private buildSchema(shapeIri: string): SchemaSpec {
    return {
      name: this.shapeIriToName.get(shapeIri)!,
      type: this.deriveType(shapeIri),
      properties: this.buildProperties(shapeIri),
    };
  }

  private deriveType(shapeIri: string): string[] {
    const targetClasses = this.getObjectIris(shapeIri, SH_TARGET_CLASS);
    if (targetClasses.length > 0) {
      return targetClasses;
    }
    const isRdfsClass = this.store.getQuads(
      shapeIri,
      RDF_TYPE,
      RDFS_CLASS,
      null,
    ).length > 0;
    return isRdfsClass ? [shapeIri] : [];
  }

  private buildProperties(shapeIri: string): SchemaSpec["properties"] {
    const propertyNodes = this.store.getQuads(
      shapeIri,
      SH_PROPERTY,
      null,
      null,
    );
    const properties: SchemaSpec["properties"] = {};

    for (const q of propertyNodes) {
      const { name, spec } = this.buildProperty(q.object, shapeIri);
      if (properties[name]) {
        // SHACL semantics: multiple property shapes targeting the same path
        // are conjoined (AND). Merge with last-wins for conflicting fields.
        properties[name] = mergePropertySpecs(properties[name], spec);
      } else {
        properties[name] = spec;
      }
    }

    return properties;
  }

  private buildProperty(
    propertyNode: Term,
    enclosingShapeIri?: string,
  ): { name: string; spec: PropertySpec } {
    const { iri: pathIri, inverse } = this.resolvePath(propertyNode);
    const name = this.getSuffix(pathIri);

    const spec: PropertySpec = { id: pathIri };
    if (inverse) {
      spec.inverse = true;
    }

    const direct = this.collectConstraints(propertyNode);
    const orBranches = this.collectOrBranches(propertyNode);

    let forceOptional = false;
    const refTarget = direct.refNode ?? direct.refClass;
    const isSelfRef = refTarget !== undefined &&
      enclosingShapeIri !== undefined && refTarget === enclosingShapeIri;

    if (direct.uniqueLang || direct.datatype === RDF_LANG_STRING) {
      spec.multilang = true;
    } else if (refTarget && !isSelfRef) {
      spec.schemaRef = this.resolveSchemaRef(refTarget);
    } else if (isSelfRef) {
      // Self-referential shapes (a Person whose `friend` is also a Person)
      // would create a circular dependency that LDkit's schema_to_script
      // cannot render. Fall back to an untyped IRI reference; users can
      // hand-edit the generated schema if they need stronger typing.
      spec.type = "@id";
    } else if (direct.datatype && direct.datatype !== XSD_STRING) {
      spec.type = direct.datatype;
    } else if (direct.nodeKind === SH_IRI) {
      spec.type = "@id";
    } else if (direct.inFirstType) {
      // sh:in: use the first list element's type; matches shex-to-schema's
      // simplification (no TS literal union — runtime can't enforce it).
      if (direct.inFirstType === "@id") {
        spec.type = "@id";
      } else if (direct.inFirstType !== XSD_STRING) {
        spec.type = direct.inFirstType;
      }
    } else if (orBranches.length > 0) {
      const reduced = this.reduceOrBranches(orBranches);
      forceOptional = true;
      if (reduced.kind === "datatype" && reduced.value !== XSD_STRING) {
        spec.type = reduced.value;
      } else if (reduced.kind === "iri") {
        spec.type = "@id";
      }
      // kind === "untyped" → leave as default (no @type)
    }

    const minCount = this.getObjectInteger(propertyNode, SH_MIN_COUNT);
    const maxCount = this.getObjectInteger(propertyNode, SH_MAX_COUNT);

    if (forceOptional || minCount === undefined || minCount === 0) {
      spec.optional = true;
    }
    if (maxCount === undefined || maxCount > 1) {
      spec.array = true;
    }

    return { name, spec };
  }

  private resolvePath(
    propertyNode: Term,
  ): { iri: string; inverse: boolean } {
    const pathTerm = this.getObjectTerm(propertyNode, SH_PATH);
    if (!pathTerm) {
      throw new Error("Property shape is missing sh:path");
    }
    if (pathTerm.termType === "NamedNode") {
      return { iri: pathTerm.value, inverse: false };
    }
    if (pathTerm.termType === "BlankNode") {
      const inverseIri = this.getObjectIri(pathTerm, SH_INVERSE_PATH);
      if (inverseIri) {
        return { iri: inverseIri, inverse: true };
      }
    }
    throw new Error(
      `Unsupported sh:path: only simple predicate IRIs and sh:inversePath are supported (got ${pathTerm.termType})`,
    );
  }

  /**
   * Collect direct constraints, recursing into sh:and (merge with last-wins
   * semantics) and sh:in (derive type from first list element). sh:not is
   * silently ignored — it expresses validation negation that has no analog
   * in LDkit's query schema.
   */
  private collectConstraints(node: Term): Constraints {
    const c: Constraints = {
      datatype: this.getObjectIri(node, SH_DATATYPE),
      nodeKind: this.getObjectIri(node, SH_NODE_KIND),
      refNode: this.getObjectIri(node, SH_NODE),
      refClass: this.getObjectIri(node, SH_CLASS),
      uniqueLang: this.getObjectBoolean(node, SH_UNIQUE_LANG),
    };

    const inListTerm = this.getObjectTerm(node, SH_IN);
    if (inListTerm) {
      const items = this.walkList(inListTerm);
      const first = items[0];
      if (first?.termType === "NamedNode") {
        c.inFirstType = "@id";
      } else if (first?.termType === "Literal") {
        const dt =
          (first as { datatype?: { value: string } }).datatype?.value ??
            XSD_STRING;
        c.inFirstType = dt;
      }
    }

    const andListTerm = this.getObjectTerm(node, SH_AND);
    if (andListTerm) {
      for (const branch of this.walkList(andListTerm)) {
        const sub = this.collectConstraints(branch);
        if (sub.datatype !== undefined) c.datatype = sub.datatype;
        if (sub.nodeKind !== undefined) c.nodeKind = sub.nodeKind;
        if (sub.refNode !== undefined) c.refNode = sub.refNode;
        if (sub.refClass !== undefined) c.refClass = sub.refClass;
        if (sub.uniqueLang !== undefined) c.uniqueLang = sub.uniqueLang;
        if (sub.inFirstType !== undefined) c.inFirstType = sub.inFirstType;
      }
    }

    return c;
  }

  private collectOrBranches(node: Term): Constraints[] {
    const orListTerm = this.getObjectTerm(node, SH_OR);
    if (!orListTerm) return [];
    return this.walkList(orListTerm).map((branch) =>
      this.collectConstraints(branch)
    );
  }

  /**
   * Reduce sh:or alternatives to a single representable type:
   * - all numeric datatypes → widest type from NUMERIC_WIDENING
   * - all same datatype → that datatype
   * - all sh:node/sh:class refs → untyped IRI ref
   * - mixed (or unrepresentable) → untyped (no @type)
   *
   * Caller should mark the resulting property as @optional to reflect that
   * its type is a simplification of multiple alternatives.
   */
  private reduceOrBranches(branches: Constraints[]): ReducedOr {
    if (branches.length === 0) {
      return { kind: "untyped" };
    }

    const allDatatypes = branches.every(
      (b) => b.datatype && !b.refNode && !b.refClass,
    );
    const allRefs = branches.every(
      (b) => (b.refNode || b.refClass) && !b.datatype,
    );

    if (allDatatypes) {
      const dts = branches.map((b) => b.datatype!);
      const widened = this.pickWidestNumeric(dts);
      if (widened) {
        return { kind: "datatype", value: widened };
      }
      const unique = new Set(dts);
      if (unique.size === 1) {
        return { kind: "datatype", value: dts[0] };
      }
      // Heterogeneous non-numeric datatypes — cannot pick safely.
      return { kind: "untyped" };
    }

    if (allRefs) {
      return { kind: "iri" };
    }

    return { kind: "untyped" };
  }

  private pickWidestNumeric(types: string[]): string | undefined {
    const indices = types.map((t) => NUMERIC_WIDENING.indexOf(t));
    if (indices.every((i) => i >= 0)) {
      return NUMERIC_WIDENING[Math.min(...indices)];
    }
    return undefined;
  }

  private walkList(listHead: Term): Term[] {
    const items: Term[] = [];
    const visited = new Set<string>();
    let current: Term | undefined = listHead;
    while (
      current &&
      !(current.termType === "NamedNode" && current.value === RDF_NIL)
    ) {
      const key = `${current.termType}:${current.value}`;
      if (visited.has(key)) break;
      visited.add(key);
      const first = this.getObjectTerm(current, RDF_FIRST);
      if (!first) break;
      items.push(first);
      const rest = this.getObjectTerm(current, RDF_REST);
      if (!rest) break;
      current = rest;
    }
    return items;
  }

  private resolveSchemaRef(iri: string): string {
    const existing = this.shapeIriToName.get(iri);
    if (existing) {
      return existing;
    }
    const cached = this.classIriToSchemaName.get(iri);
    if (cached) {
      return cached;
    }
    const name = this.uniqueName(
      `${this.capitalize(this.sanitizeIdentifier(this.getSuffix(iri)))}Schema`,
    );
    this.classIriToSchemaName.set(iri, name);
    return name;
  }

  /**
   * Convert an arbitrary string into a valid TypeScript identifier. SHACL
   * IRIs commonly include `-`, `.`, `:` and other characters that work as
   * RDF local parts but break TS identifier syntax (`const Foo-Bar = …`).
   * Replace each invalid character with `_`; prefix a `_` if the result
   * starts with a digit so the identifier is well-formed.
   */
  private sanitizeIdentifier(value: string): string {
    let cleaned = value.replace(/[^A-Za-z0-9_$]/g, "_");
    if (cleaned.length > 0 && /^[0-9]/.test(cleaned)) {
      cleaned = `_${cleaned}`;
    }
    return cleaned;
  }

  private getObjectTerm(
    subject: Term | string,
    predicate: string,
  ): Term | undefined {
    const quads = this.store.getQuads(subject, predicate, null, null);
    return quads[0]?.object;
  }

  private getObjectIri(
    subject: Term | string,
    predicate: string,
  ): string | undefined {
    const term = this.getObjectTerm(subject, predicate);
    if (term && term.termType === "NamedNode") {
      return term.value;
    }
    return undefined;
  }

  private getObjectIris(
    subject: Term | string,
    predicate: string,
  ): string[] {
    const quads = this.store.getQuads(subject, predicate, null, null);
    const result: string[] = [];
    for (const q of quads) {
      if (q.object.termType === "NamedNode") {
        result.push(q.object.value);
      }
    }
    return result;
  }

  private getObjectInteger(
    subject: Term | string,
    predicate: string,
  ): number | undefined {
    const term = this.getObjectTerm(subject, predicate);
    if (term && term.termType === "Literal") {
      const parsed = parseInt(term.value, 10);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return undefined;
  }

  private getObjectBoolean(
    subject: Term | string,
    predicate: string,
  ): boolean | undefined {
    const term = this.getObjectTerm(subject, predicate);
    if (term && term.termType === "Literal") {
      if (term.value === "true") return true;
      if (term.value === "false") return false;
    }
    return undefined;
  }

  private getSuffix(value: string): string {
    const cutoff = Math.max(value.lastIndexOf("#"), value.lastIndexOf("/"));
    if (cutoff === -1) {
      return value;
    }
    return value.substring(cutoff + 1);
  }

  private capitalize(value: string): string {
    if (value.length === 0) return value;
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
}
