// Copyright 2024 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import fs from 'fs/promises';
import path from 'path';
import ts from 'typescript';
import prettier from 'prettier';

import { getICUMessageParams } from '../util/getICUMessageParams';
import type { ICUMessageParamType } from '../util/getICUMessageParams';
import { missingCaseError } from '../util/missingCaseError';
import globalMessages from '../../_locales/en/messages.json';

import { DELETED_REGEXP } from './constants';

function translateParamType(
  param: ICUMessageParamType,
  stringType: ts.TypeNode,
  componentType: ts.TypeNode
): ts.TypeNode {
  switch (param.type) {
    case 'string':
      return stringType;
    case 'number':
      return ts.factory.createToken(ts.SyntaxKind.NumberKeyword);
    case 'date':
    case 'time':
      return ts.factory.createTypeReferenceNode('Date');
    case 'jsx':
      return componentType;
    case 'select':
      return ts.factory.createUnionTypeNode(
        param.validOptions.map(option => {
          if (option === 'other') {
            return stringType;
          }

          return ts.factory.createLiteralTypeNode(
            ts.factory.createStringLiteral(option, true)
          );
        })
      );
    default:
      throw missingCaseError(param);
  }
}

const messageKeys = Object.keys(globalMessages).sort((a, b) => {
  return a.localeCompare(b);
}) as Array<keyof typeof globalMessages>;

function generateType(
  name: string,
  stringType: ts.TypeNode,
  componentType: ts.TypeNode
): ts.Statement {
  const props = new Array<ts.TypeElement>();
  for (const key of messageKeys) {
    if (key === 'smartling') {
      continue;
    }

    const message = globalMessages[key];

    // Skip deleted strings
    if ('description' in message && DELETED_REGEXP.test(message.description)) {
      continue;
    }

    const { messageformat } = message;

    const params = getICUMessageParams(messageformat);

    let paramType: ts.TypeNode;
    if (params.size === 0) {
      paramType = ts.factory.createToken(ts.SyntaxKind.UndefinedKeyword);
    } else {
      const subTypes = new Array<ts.TypeElement>();

      for (const [paramName, value] of params) {
        subTypes.push(
          ts.factory.createPropertySignature(
            undefined,
            ts.factory.createStringLiteral(paramName, true),
            undefined,
            translateParamType(value, stringType, componentType)
          )
        );
      }

      paramType = ts.factory.createTypeLiteralNode(subTypes);
    }

    props.push(
      ts.factory.createPropertySignature(
        undefined,
        ts.factory.createStringLiteral(key, true),
        undefined,
        paramType
      )
    );
  }

  return ts.factory.createTypeAliasDeclaration(
    [ts.factory.createToken(ts.SyntaxKind.ExportKeyword)],
    name,
    undefined,
    ts.factory.createTypeLiteralNode(props)
  );
}

const statements = new Array<ts.Statement>();

let top = ts.factory.createImportDeclaration(
  undefined,
  ts.factory.createImportClause(
    true,
    undefined,
    ts.factory.createNamedImports([
      ts.factory.createImportSpecifier(
        false,
        undefined,
        ts.factory.createIdentifier('ReactNode')
      ),
    ])
  ),
  ts.factory.createStringLiteral('react')
);

top = ts.addSyntheticLeadingComment(
  top,
  ts.SyntaxKind.SingleLineCommentTrivia,
  ` Copyright ${new Date().getFullYear()} Signal Messenger, LLC`
);

top = ts.addSyntheticLeadingComment(
  top,
  ts.SyntaxKind.SingleLineCommentTrivia,
  ' SPDX-License-Identifier: AGPL-3.0-only'
);

statements.push(top);

const JSXElement = ts.factory.createTypeReferenceNode(
  ts.factory.createQualifiedName(ts.factory.createIdentifier('JSX'), 'Element')
);

statements.push(
  ts.factory.createTypeAliasDeclaration(
    undefined,
    'Component',
    undefined,
    ts.factory.createUnionTypeNode([
      JSXElement,
      ts.factory.createFunctionTypeNode(
        undefined,
        [
          ts.factory.createParameterDeclaration(
            undefined,
            undefined,
            'parts',
            undefined,
            ts.factory.createTypeReferenceNode('Array', [
              ts.factory.createUnionTypeNode([
                ts.factory.createToken(ts.SyntaxKind.StringKeyword),
                JSXElement,
              ]),
            ])
          ),
        ],
        JSXElement
      ),
    ])
  )
);

statements.push(
  ts.factory.createTypeAliasDeclaration(
    undefined,
    'ComponentOrString',
    undefined,
    ts.factory.createUnionTypeNode([
      ts.factory.createToken(ts.SyntaxKind.StringKeyword),
      ts.factory.createTypeReferenceNode('ReadonlyArray', [
        ts.factory.createUnionTypeNode([
          ts.factory.createToken(ts.SyntaxKind.StringKeyword),
          JSXElement,
        ]),
      ]),
      ts.factory.createTypeReferenceNode('Component'),
    ])
  )
);

statements.push(
  generateType(
    'ICUJSXMessageParamsByKeyType',
    ts.factory.createTypeReferenceNode('ComponentOrString'),
    ts.factory.createTypeReferenceNode('Component')
  )
);

statements.push(
  generateType(
    'ICUStringMessageParamsByKeyType',
    ts.factory.createToken(ts.SyntaxKind.StringKeyword),
    ts.factory.createToken(ts.SyntaxKind.NeverKeyword)
  )
);

const root = ts.factory.createSourceFile(
  statements,
  ts.factory.createToken(ts.SyntaxKind.EndOfFileToken),
  ts.NodeFlags.None
);

const resultFile = ts.createSourceFile(
  'icuTypes.d.ts',
  '',
  ts.ScriptTarget.Latest,
  false,
  ts.ScriptKind.TS
);
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
const unformattedOutput = printer.printNode(
  ts.EmitHint.Unspecified,
  root,
  resultFile
);

async function main() {
  const destinationPath = path.join(
    __dirname,
    '..',
    '..',
    'build',
    'ICUMessageParams.d.ts'
  );
  const prettierConfig = await prettier.resolveConfig(destinationPath);
  const output = prettier.format(unformattedOutput, {
    ...prettierConfig,
    filepath: destinationPath,
  });

  await fs.writeFile(destinationPath, output);
}
main().catch(error => {
  console.error(error);
  process.exit(1);
});
