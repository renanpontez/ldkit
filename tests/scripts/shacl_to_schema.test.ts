import { assertEquals, assertThrows } from "../test_deps.ts";
import { shaclToSchema } from "../../scripts/shacl_to_schema.ts";
import {
  type ExtraNamespace,
  type SchemaSpec,
} from "../../scripts/schema_to_script.ts";

const testSchemas = (ttl: string, schemas: SchemaSpec[]) => {
  const result = shaclToSchema(ttl);
  assertEquals(result.schemas, schemas);
};

const testSchema = (ttl: string, schema: SchemaSpec) => {
  return testSchemas(ttl, [schema]);
};

const PREFIXES = `
@prefix ex: <http://example.org/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
`;

Deno.test("Scripts / SHACL to Schema / Project namespaces emitted as createNamespace specs", () => {
  // User-declared @prefix declarations whose IRI is not an LDkit built-in
  // surface as `extraNamespaces`. Built-in IRIs (xsd, rdfs, sh) and unused
  // ones are dropped. Conflicting prefix names get suffixed with `_`.
  const input = `
@prefix m: <https://marketer.com/vocab#> .
@prefix attio: <https://marketer.com/vocab/attio#> .
@prefix schema: <https://schema.org/> .
@prefix unused: <http://example.org/unused#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

m:CampaignShape a sh:NodeShape ;
  sh:targetClass m:Campaign ;
  sh:property [ sh:path m:label ; sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ] ;
  sh:property [ sh:path schema:dateCreated ; sh:datatype xsd:dateTime ; sh:minCount 1 ; sh:maxCount 1 ] ;
  sh:property [ sh:path attio:source ; sh:nodeKind sh:IRI ; sh:minCount 1 ; sh:maxCount 1 ] .
`;

  const result = shaclToSchema(input);

  // Schemas use raw IRIs in the IR; the printer applies the namespace
  // prefixes downstream.
  assertEquals(result.schemas, [
    {
      name: "CampaignSchema",
      type: ["https://marketer.com/vocab#Campaign"],
      properties: {
        label: { id: "https://marketer.com/vocab#label" },
        dateCreated: {
          id: "https://schema.org/dateCreated",
          type: "http://www.w3.org/2001/XMLSchema#dateTime",
        },
        source: {
          id: "https://marketer.com/vocab/attio#source",
          type: "@id",
        },
      },
    },
  ]);

  // Three project namespaces emitted (m, attio, schema_), in the order they
  // were declared. Built-in `sh` and `xsd` are filtered out. `unused` is
  // dropped because no IRI references it. The `schema` prefix conflicts with
  // LDkit's built-in import name, so it's suffixed to `schema_`.
  const expected: ExtraNamespace[] = [
    { iri: "https://marketer.com/vocab#", prefix: "m" },
    { iri: "https://marketer.com/vocab/attio#", prefix: "attio" },
    { iri: "https://schema.org/", prefix: "schema_" },
  ];
  assertEquals(result.extraNamespaces, expected);
});

Deno.test("Scripts / SHACL to Schema / Missing sh:path error names the enclosing shape", () => {
  // When a property shape has no sh:path, the error message must identify
  // *which* shape it belongs to — otherwise debugging a 14k-line SHACL is
  // a needle-in-a-haystack.
  const input = `${PREFIXES}
ex:PersonShape a sh:NodeShape ;
  sh:targetClass ex:Person ;
  sh:property [ sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ] .
`;

  assertThrows(
    () => shaclToSchema(input),
    Error,
    "PersonShape",
  );
});

Deno.test("Scripts / SHACL to Schema / Complex sh:path error names the enclosing shape", () => {
  // Same context-in-error rule for the unsupported-path case.
  const input = `${PREFIXES}
ex:PersonShape a sh:NodeShape ;
  sh:targetClass ex:Person ;
  sh:property [
    sh:path ( ex:hop1 ex:hop2 ) ;
    sh:datatype xsd:string
  ] .
`;

  assertThrows(
    () => shaclToSchema(input),
    Error,
    "PersonShape",
  );
});

Deno.test("Scripts / SHACL to Schema / Single property with default datatype", () => {
  const input = `${PREFIXES}
ex:PersonShape a sh:NodeShape ;
  sh:targetClass ex:Person ;
  sh:property [
    sh:path ex:name ;
    sh:datatype xsd:string ;
    sh:minCount 1 ;
    sh:maxCount 1
  ] .
`;

  const schema: SchemaSpec = {
    name: "PersonSchema",
    type: ["http://example.org/Person"],
    properties: {
      name: { id: "http://example.org/name" },
    },
  };

  testSchema(input, schema);
});

Deno.test("Scripts / SHACL to Schema / Datatype mapping", () => {
  const input = `${PREFIXES}
ex:ThingShape a sh:NodeShape ;
  sh:targetClass ex:Thing ;
  sh:property [ sh:path ex:age ; sh:datatype xsd:integer ; sh:minCount 1 ; sh:maxCount 1 ] ;
  sh:property [ sh:path ex:active ; sh:datatype xsd:boolean ; sh:minCount 1 ; sh:maxCount 1 ] ;
  sh:property [ sh:path ex:born ; sh:datatype xsd:date ; sh:minCount 1 ; sh:maxCount 1 ] ;
  sh:property [ sh:path ex:created ; sh:datatype xsd:dateTime ; sh:minCount 1 ; sh:maxCount 1 ] ;
  sh:property [ sh:path ex:price ; sh:datatype xsd:decimal ; sh:minCount 1 ; sh:maxCount 1 ] .
`;

  const schema: SchemaSpec = {
    name: "ThingSchema",
    type: ["http://example.org/Thing"],
    properties: {
      age: {
        id: "http://example.org/age",
        type: "http://www.w3.org/2001/XMLSchema#integer",
      },
      active: {
        id: "http://example.org/active",
        type: "http://www.w3.org/2001/XMLSchema#boolean",
      },
      born: {
        id: "http://example.org/born",
        type: "http://www.w3.org/2001/XMLSchema#date",
      },
      created: {
        id: "http://example.org/created",
        type: "http://www.w3.org/2001/XMLSchema#dateTime",
      },
      price: {
        id: "http://example.org/price",
        type: "http://www.w3.org/2001/XMLSchema#decimal",
      },
    },
  };

  testSchema(input, schema);
});

Deno.test("Scripts / SHACL to Schema / Optional property when minCount is missing", () => {
  const input = `${PREFIXES}
ex:PersonShape a sh:NodeShape ;
  sh:targetClass ex:Person ;
  sh:property [ sh:path ex:nickname ; sh:datatype xsd:string ; sh:maxCount 1 ] .
`;

  const schema: SchemaSpec = {
    name: "PersonSchema",
    type: ["http://example.org/Person"],
    properties: {
      nickname: {
        id: "http://example.org/nickname",
        optional: true,
      },
    },
  };

  testSchema(input, schema);
});

Deno.test("Scripts / SHACL to Schema / Array when maxCount is unbounded", () => {
  const input = `${PREFIXES}
ex:PersonShape a sh:NodeShape ;
  sh:targetClass ex:Person ;
  sh:property [ sh:path ex:tag ; sh:datatype xsd:string ; sh:minCount 1 ] ;
  sh:property [ sh:path ex:alias ; sh:datatype xsd:string ; sh:maxCount 5 ] .
`;

  const schema: SchemaSpec = {
    name: "PersonSchema",
    type: ["http://example.org/Person"],
    properties: {
      tag: {
        id: "http://example.org/tag",
        array: true,
      },
      alias: {
        id: "http://example.org/alias",
        optional: true,
        array: true,
      },
    },
  };

  testSchema(input, schema);
});

Deno.test("Scripts / SHACL to Schema / IRI reference via sh:nodeKind", () => {
  const input = `${PREFIXES}
ex:PersonShape a sh:NodeShape ;
  sh:targetClass ex:Person ;
  sh:property [ sh:path ex:homepage ; sh:nodeKind sh:IRI ; sh:minCount 1 ; sh:maxCount 1 ] .
`;

  const schema: SchemaSpec = {
    name: "PersonSchema",
    type: ["http://example.org/Person"],
    properties: {
      homepage: {
        id: "http://example.org/homepage",
        type: "@id",
      },
    },
  };

  testSchema(input, schema);
});

Deno.test("Scripts / SHACL to Schema / Multilang via rdf:langString", () => {
  const input = `${PREFIXES}
ex:PersonShape a sh:NodeShape ;
  sh:targetClass ex:Person ;
  sh:property [ sh:path ex:bio ; sh:datatype rdf:langString ; sh:minCount 1 ; sh:maxCount 1 ] .
`;

  const schema: SchemaSpec = {
    name: "PersonSchema",
    type: ["http://example.org/Person"],
    properties: {
      bio: {
        id: "http://example.org/bio",
        multilang: true,
      },
    },
  };

  testSchema(input, schema);
});

Deno.test("Scripts / SHACL to Schema / Nested shape via sh:node", () => {
  const input = `${PREFIXES}
ex:PersonShape a sh:NodeShape ;
  sh:targetClass ex:Person ;
  sh:property [
    sh:path ex:address ;
    sh:node ex:AddressShape ;
    sh:minCount 1 ;
    sh:maxCount 1
  ] .

ex:AddressShape a sh:NodeShape ;
  sh:targetClass ex:Address ;
  sh:property [ sh:path ex:street ; sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ] .
`;

  const personSchema: SchemaSpec = {
    name: "PersonSchema",
    type: ["http://example.org/Person"],
    properties: {
      address: {
        id: "http://example.org/address",
        schemaRef: "AddressSchema",
      },
    },
  };

  const addressSchema: SchemaSpec = {
    name: "AddressSchema",
    type: ["http://example.org/Address"],
    properties: {
      street: { id: "http://example.org/street" },
    },
  };

  testSchemas(input, [personSchema, addressSchema]);
});

Deno.test("Scripts / SHACL to Schema / Shape without targetClass uses shape IRI as type", () => {
  const input = `${PREFIXES}
ex:Memory a rdfs:Class, sh:NodeShape ;
  sh:property [ sh:path ex:label ; sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ] .
`;

  const schema: SchemaSpec = {
    name: "MemorySchema",
    type: ["http://example.org/Memory"],
    properties: {
      label: { id: "http://example.org/label" },
    },
  };

  testSchema(input, schema);
});

Deno.test("Scripts / SHACL to Schema / Multiple shapes in one file", () => {
  const input = `${PREFIXES}
ex:PersonShape a sh:NodeShape ;
  sh:targetClass ex:Person ;
  sh:property [ sh:path ex:name ; sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ] .

ex:CompanyShape a sh:NodeShape ;
  sh:targetClass ex:Company ;
  sh:property [ sh:path ex:name ; sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ] .
`;

  const personSchema: SchemaSpec = {
    name: "PersonSchema",
    type: ["http://example.org/Person"],
    properties: {
      name: { id: "http://example.org/name" },
    },
  };

  const companySchema: SchemaSpec = {
    name: "CompanySchema",
    type: ["http://example.org/Company"],
    properties: {
      name: { id: "http://example.org/name" },
    },
  };

  testSchemas(input, [personSchema, companySchema]);
});

Deno.test("Scripts / SHACL to Schema / Complex shape mirroring metric repo m:Ad", () => {
  const input = `${PREFIXES}
@prefix m: <https://marketer.com/vocab#> .
@prefix schema: <https://schema.org/> .

m:AdShape a sh:NodeShape ;
  sh:targetClass m:Ad ;
  sh:property [
    sh:path rdfs:label ;
    sh:datatype xsd:string ;
    sh:maxCount 1
  ] ;
  sh:property [
    sh:path schema:dateModified ;
    sh:datatype xsd:dateTime ;
    sh:maxCount 1
  ] ;
  sh:property [
    sh:path m:status ;
    sh:nodeKind sh:IRI ;
    sh:maxCount 1
  ] ;
  sh:property [
    sh:path m:audience ;
    sh:node m:AudienceShape ;
    sh:maxCount 1
  ] ;
  sh:property [
    sh:path m:tags ;
    sh:datatype xsd:string
  ] .

m:AudienceShape a sh:NodeShape ;
  sh:targetClass m:Audience ;
  sh:property [ sh:path rdfs:label ; sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ] .
`;

  const adSchema: SchemaSpec = {
    name: "AdSchema",
    type: ["https://marketer.com/vocab#Ad"],
    properties: {
      label: {
        id: "http://www.w3.org/2000/01/rdf-schema#label",
        optional: true,
      },
      dateModified: {
        id: "https://schema.org/dateModified",
        type: "http://www.w3.org/2001/XMLSchema#dateTime",
        optional: true,
      },
      status: {
        id: "https://marketer.com/vocab#status",
        type: "@id",
        optional: true,
      },
      audience: {
        id: "https://marketer.com/vocab#audience",
        schemaRef: "AudienceSchema",
        optional: true,
      },
      tags: {
        id: "https://marketer.com/vocab#tags",
        optional: true,
        array: true,
      },
    },
  };

  const audienceSchema: SchemaSpec = {
    name: "AudienceSchema",
    type: ["https://marketer.com/vocab#Audience"],
    properties: {
      label: { id: "http://www.w3.org/2000/01/rdf-schema#label" },
    },
  };

  testSchemas(input, [adSchema, audienceSchema]);
});

Deno.test("Scripts / SHACL to Schema / sh:or of numeric datatypes picks widest", () => {
  const input = `${PREFIXES}
ex:ProductShape a sh:NodeShape ;
  sh:targetClass ex:Product ;
  sh:property [
    sh:path ex:price ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:or (
      [ sh:datatype xsd:integer ]
      [ sh:datatype xsd:decimal ]
      [ sh:datatype xsd:double ]
    )
  ] .
`;

  const schema: SchemaSpec = {
    name: "ProductSchema",
    type: ["http://example.org/Product"],
    properties: {
      price: {
        id: "http://example.org/price",
        type: "http://www.w3.org/2001/XMLSchema#decimal",
        optional: true,
      },
    },
  };

  testSchema(input, schema);
});

Deno.test("Scripts / SHACL to Schema / sh:or of sh:node refs reduces to untyped IRI", () => {
  const input = `${PREFIXES}
ex:AdShape a sh:NodeShape ;
  sh:targetClass ex:Ad ;
  sh:property [
    sh:path ex:creative ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:or (
      [ sh:node ex:ImageShape ]
      [ sh:node ex:VideoShape ]
    )
  ] .

ex:ImageShape a sh:NodeShape ;
  sh:targetClass ex:Image ;
  sh:property [ sh:path ex:url ; sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ] .

ex:VideoShape a sh:NodeShape ;
  sh:targetClass ex:Video ;
  sh:property [ sh:path ex:url ; sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ] .
`;

  const adSchema: SchemaSpec = {
    name: "AdSchema",
    type: ["http://example.org/Ad"],
    properties: {
      creative: {
        id: "http://example.org/creative",
        type: "@id",
        optional: true,
      },
    },
  };

  const imageSchema: SchemaSpec = {
    name: "ImageSchema",
    type: ["http://example.org/Image"],
    properties: { url: { id: "http://example.org/url" } },
  };

  const videoSchema: SchemaSpec = {
    name: "VideoSchema",
    type: ["http://example.org/Video"],
    properties: { url: { id: "http://example.org/url" } },
  };

  testSchemas(input, [adSchema, imageSchema, videoSchema]);
});

Deno.test("Scripts / SHACL to Schema / sh:or of validation-only branches drops to plain default", () => {
  const input = `${PREFIXES}
ex:LinkShape a sh:NodeShape ;
  sh:targetClass ex:Link ;
  sh:property [
    sh:path ex:href ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:or (
      [ sh:maxLength 3 ]
      [ sh:pattern "^https?://" ]
    )
  ] .
`;

  const schema: SchemaSpec = {
    name: "LinkSchema",
    type: ["http://example.org/Link"],
    properties: {
      href: {
        id: "http://example.org/href",
        optional: true,
      },
    },
  };

  testSchema(input, schema);
});

Deno.test("Scripts / SHACL to Schema / sh:and merges branch constraints", () => {
  const input = `${PREFIXES}
ex:PersonShape a sh:NodeShape ;
  sh:targetClass ex:Person ;
  sh:property [
    sh:path ex:age ;
    sh:and (
      [ sh:datatype xsd:integer ]
      [ sh:minCount 1 ]
    ) ;
    sh:maxCount 1
  ] .
`;

  const schema: SchemaSpec = {
    name: "PersonSchema",
    type: ["http://example.org/Person"],
    properties: {
      age: {
        id: "http://example.org/age",
        type: "http://www.w3.org/2001/XMLSchema#integer",
        // sh:and merged the datatype constraint, but sh:minCount lives only
        // inside the sh:and branch — top-level minCount is missing, so the
        // property remains optional. (Validators would still enforce it.)
        optional: true,
      },
    },
  };

  testSchema(input, schema);
});

Deno.test("Scripts / SHACL to Schema / sh:not is silently ignored", () => {
  const input = `${PREFIXES}
ex:PersonShape a sh:NodeShape ;
  sh:targetClass ex:Person ;
  sh:property [
    sh:path ex:age ;
    sh:datatype xsd:integer ;
    sh:not [ sh:hasValue 0 ] ;
    sh:minCount 1 ;
    sh:maxCount 1
  ] .
`;

  const schema: SchemaSpec = {
    name: "PersonSchema",
    type: ["http://example.org/Person"],
    properties: {
      age: {
        id: "http://example.org/age",
        type: "http://www.w3.org/2001/XMLSchema#integer",
      },
    },
  };

  testSchema(input, schema);
});

Deno.test("Scripts / SHACL to Schema / sh:in with string values yields default string type", () => {
  const input = `${PREFIXES}
ex:TaskShape a sh:NodeShape ;
  sh:targetClass ex:Task ;
  sh:property [
    sh:path ex:status ;
    sh:in ( "active" "paused" "deleted" ) ;
    sh:minCount 1 ;
    sh:maxCount 1
  ] .
`;

  const schema: SchemaSpec = {
    name: "TaskSchema",
    type: ["http://example.org/Task"],
    properties: {
      status: { id: "http://example.org/status" },
    },
  };

  testSchema(input, schema);
});

Deno.test("Scripts / SHACL to Schema / sh:in with IRI values yields IRI reference", () => {
  const input = `${PREFIXES}
ex:TaskShape a sh:NodeShape ;
  sh:targetClass ex:Task ;
  sh:property [
    sh:path ex:state ;
    sh:in ( ex:Active ex:Paused ex:Deleted ) ;
    sh:minCount 1 ;
    sh:maxCount 1
  ] .
`;

  const schema: SchemaSpec = {
    name: "TaskSchema",
    type: ["http://example.org/Task"],
    properties: {
      state: {
        id: "http://example.org/state",
        type: "@id",
      },
    },
  };

  testSchema(input, schema);
});

Deno.test("Scripts / SHACL to Schema / Self-referential sh:node falls back to untyped IRI", () => {
  // A Person shape with a `friend` property that points back at PersonShape
  // would create a circular schema dependency that LDkit's printer cannot
  // emit. The converter should detect the self-reference and fall back to
  // an untyped IRI reference rather than throwing.
  const input = `${PREFIXES}
ex:PersonShape a sh:NodeShape ;
  sh:targetClass ex:Person ;
  sh:property [
    sh:path ex:friend ;
    sh:node ex:PersonShape
  ] .
`;

  const schema: SchemaSpec = {
    name: "PersonSchema",
    type: ["http://example.org/Person"],
    properties: {
      friend: {
        id: "http://example.org/friend",
        type: "@id",
        optional: true,
        array: true,
      },
    },
  };

  testSchema(input, schema);
});

Deno.test("Scripts / SHACL to Schema / Schema names with hyphens are sanitized for TS", () => {
  // SHACL local parts with hyphens (or other non-identifier chars) must not
  // bleed into TypeScript const names. `Foo-Bar` becomes `Foo_Bar`.
  const input = `${PREFIXES}
ex:FacebookCarouselCard-InputShape a sh:NodeShape ;
  sh:targetClass ex:FacebookCarouselCard-Input ;
  sh:property [ sh:path ex:asset ; sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ] .
`;

  const schema: SchemaSpec = {
    name: "FacebookCarouselCard_InputSchema",
    type: ["http://example.org/FacebookCarouselCard-Input"],
    properties: {
      asset: { id: "http://example.org/asset" },
    },
  };

  testSchema(input, schema);
});

Deno.test("Scripts / SHACL to Schema / Merging sh:nodeKind sh:IRI with sh:node keeps only schemaRef", () => {
  // Real Metric pattern: `m:CampaignPerformanceSummaryShape` has multiple
  // sh:property shapes on `m:campaign` — one with `sh:nodeKind sh:IRI` and
  // another with `sh:node m:CampaignShape`. LDkit's encoder/decoder/query
  // builder all ignore `@type` when `@schema` is present (see library/
  // {decoder,encoder,schema/interface}.ts), so emitting both is dead code.
  // The merge must drop `type` whenever either branch sets `schemaRef`.
  const input = `${PREFIXES}
ex:SummaryShape a sh:NodeShape ;
  sh:targetClass ex:Summary ;
  sh:property [ sh:path ex:campaign ; sh:nodeKind sh:IRI ; sh:maxCount 1 ] ;
  sh:property [ sh:path ex:campaign ; sh:node ex:CampaignShape ; sh:maxCount 1 ] .

ex:CampaignShape a sh:NodeShape ;
  sh:targetClass ex:Campaign ;
  sh:property [ sh:path ex:label ; sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ] .
`;

  const summarySchema: SchemaSpec = {
    name: "SummarySchema",
    type: ["http://example.org/Summary"],
    properties: {
      campaign: {
        id: "http://example.org/campaign",
        schemaRef: "CampaignSchema",
        optional: true,
      },
    },
  };

  const campaignSchema: SchemaSpec = {
    name: "CampaignSchema",
    type: ["http://example.org/Campaign"],
    properties: {
      label: { id: "http://example.org/label" },
    },
  };

  testSchemas(input, [summarySchema, campaignSchema]);
});

Deno.test("Scripts / SHACL to Schema / Multiple property shapes on same path are merged", () => {
  // SHACL semantics: each sh:property is independently applied (AND).
  // The converter merges them into a single property spec to fit LDkit's
  // one-slot-per-property model.
  const input = `${PREFIXES}
ex:ReportShape a sh:NodeShape ;
  sh:targetClass ex:Report ;
  sh:property [
    sh:path ex:value ;
    sh:datatype xsd:integer
  ] ;
  sh:property [
    sh:path ex:value ;
    sh:minCount 1 ;
    sh:maxCount 1
  ] .
`;

  const schema: SchemaSpec = {
    name: "ReportSchema",
    type: ["http://example.org/Report"],
    properties: {
      value: {
        id: "http://example.org/value",
        type: "http://www.w3.org/2001/XMLSchema#integer",
      },
    },
  };

  testSchema(input, schema);
});

Deno.test("Scripts / SHACL to Schema / sh:inversePath sets inverse flag", () => {
  const input = `${PREFIXES}
ex:PersonShape a sh:NodeShape ;
  sh:targetClass ex:Person ;
  sh:property [
    sh:path [ sh:inversePath ex:parent ] ;
    sh:nodeKind sh:IRI
  ] .
`;

  const schema: SchemaSpec = {
    name: "PersonSchema",
    type: ["http://example.org/Person"],
    properties: {
      parent: {
        id: "http://example.org/parent",
        type: "@id",
        inverse: true,
        optional: true,
        array: true,
      },
    },
  };

  testSchema(input, schema);
});
