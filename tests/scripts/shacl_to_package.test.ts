import { assertEquals } from "../test_deps.ts";
import { shaclToSchema } from "../../scripts/shacl_to_schema.ts";
import { schemaToPackage } from "../../scripts/schema_to_package.ts";

Deno.test("Scripts / SHACL to Package / Two namespaces split into two files", () => {
  const input = `
@prefix ex: <http://example.org/widget#> .
@prefix gad: <http://example.org/gadget#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

ex:WidgetShape a sh:NodeShape ;
  sh:targetClass ex:Widget ;
  sh:property [ sh:path ex:label ; sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ] .

gad:GadgetShape a sh:NodeShape ;
  sh:targetClass gad:Gadget ;
  sh:property [ sh:path gad:size ; sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ] .
`;

  const { schemas, extraNamespaces, schemaSourcePrefixes } = shaclToSchema(
    input,
    { prefixAliases: { ex: "Widget" } },
  );
  const { files } = schemaToPackage(schemas, extraNamespaces, {
    prefixAliases: { ex: "Widget" },
    schemaSourcePrefixes,
  });

  assertEquals(
    [...files.keys()].toSorted(),
    ["gad", "index", "widget"],
  );

  const widget = files.get("widget")!;
  const gad = files.get("gad")!;
  const index = files.get("index")!;

  if (!widget.includes("WidgetWidgetSchema")) {
    throw new Error("widget.ts missing WidgetWidgetSchema:\n" + widget);
  }
  if (!gad.includes("GadGadgetSchema")) {
    throw new Error("gad.ts missing GadGadgetSchema:\n" + gad);
  }
  if (widget.includes('from "./gad"')) {
    throw new Error(
      "widget.ts should not import from gad when no cross-ref:\n" + widget,
    );
  }
  assertEquals(
    index,
    `export * from "./gad";\nexport * from "./widget";\n`,
  );
});

Deno.test("Scripts / SHACL to Package / Schemas without source prefix land in fallback file", () => {
  const input = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<http://untyped.example/SoloShape> a sh:NodeShape ;
  sh:targetClass <http://untyped.example/Solo> ;
  sh:property [ sh:path <http://untyped.example/label> ; sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ] .
`;

  const { schemas, extraNamespaces, schemaSourcePrefixes } = shaclToSchema(
    input,
  );
  const { files } = schemaToPackage(schemas, extraNamespaces, {
    schemaSourcePrefixes,
  });

  if (!files.has("_unknown")) {
    throw new Error(
      "Expected _unknown fallback file. Got: " +
        [...files.keys()].join(", "),
    );
  }
});
