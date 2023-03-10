"use strict";
/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWrapEnumsTransformer = void 0;
const ts = __importStar(require("typescript"));
const ast_utils_1 = require("../helpers/ast-utils");
function isBlockLike(node) {
    return (node.kind === ts.SyntaxKind.Block ||
        node.kind === ts.SyntaxKind.ModuleBlock ||
        node.kind === ts.SyntaxKind.CaseClause ||
        node.kind === ts.SyntaxKind.DefaultClause ||
        node.kind === ts.SyntaxKind.SourceFile);
}
function getWrapEnumsTransformer() {
    return (context) => {
        const transformer = (sf) => {
            const result = visitBlockStatements(sf.statements, context);
            return context.factory.updateSourceFile(sf, ts.setTextRange(result, sf.statements));
        };
        return transformer;
    };
}
exports.getWrapEnumsTransformer = getWrapEnumsTransformer;
function visitBlockStatements(statements, context) {
    // copy of statements to modify; lazy initialized
    let updatedStatements;
    const nodeFactory = context.factory;
    const visitor = (node) => {
        if (isBlockLike(node)) {
            let result = visitBlockStatements(node.statements, context);
            if (result === node.statements) {
                return node;
            }
            result = ts.setTextRange(result, node.statements);
            switch (node.kind) {
                case ts.SyntaxKind.Block:
                    return nodeFactory.updateBlock(node, result);
                case ts.SyntaxKind.ModuleBlock:
                    return nodeFactory.updateModuleBlock(node, result);
                case ts.SyntaxKind.CaseClause:
                    return nodeFactory.updateCaseClause(node, node.expression, result);
                case ts.SyntaxKind.DefaultClause:
                    return nodeFactory.updateDefaultClause(node, result);
                default:
                    return node;
            }
        }
        else {
            return node;
        }
    };
    // 'oIndex' is the original statement index; 'uIndex' is the updated statement index
    for (let oIndex = 0, uIndex = 0; oIndex < statements.length - 1; oIndex++, uIndex++) {
        const currentStatement = statements[oIndex];
        let newStatement;
        let oldStatementsLength = 0;
        // these can't contain an enum declaration
        if (currentStatement.kind === ts.SyntaxKind.ImportDeclaration) {
            continue;
        }
        // enum declarations must:
        //   * not be last statement
        //   * be a variable statement
        //   * have only one declaration
        //   * have an identifer as a declaration name
        // ClassExpression declarations must:
        //   * not be last statement
        //   * be a variable statement
        //   * have only one declaration
        //   * have an ClassExpression or BinaryExpression and a right
        //     of kind ClassExpression as a initializer
        if (ts.isVariableStatement(currentStatement) &&
            currentStatement.declarationList.declarations.length === 1) {
            const variableDeclaration = currentStatement.declarationList.declarations[0];
            const initializer = variableDeclaration.initializer;
            if (ts.isIdentifier(variableDeclaration.name)) {
                const name = variableDeclaration.name.text;
                if (!initializer) {
                    const iife = findEnumIife(name, statements[oIndex + 1]);
                    if (iife) {
                        // update IIFE and replace variable statement and old IIFE
                        oldStatementsLength = 2;
                        newStatement = updateEnumIife(nodeFactory, currentStatement, iife[0], iife[1]);
                        // skip IIFE statement
                        oIndex++;
                    }
                }
                else if (ts.isClassExpression(initializer) ||
                    (ts.isBinaryExpression(initializer) && ts.isClassExpression(initializer.right))) {
                    const classStatements = findStatements(name, statements, oIndex);
                    if (!classStatements) {
                        continue;
                    }
                    oldStatementsLength = classStatements.length;
                    newStatement = createWrappedClass(nodeFactory, variableDeclaration, classStatements);
                    oIndex += classStatements.length - 1;
                }
            }
        }
        else if (ts.isClassDeclaration(currentStatement)) {
            const name = currentStatement.name.text;
            const classStatements = findStatements(name, statements, oIndex);
            if (!classStatements) {
                continue;
            }
            oldStatementsLength = classStatements.length;
            newStatement = createWrappedClass(nodeFactory, currentStatement, classStatements);
            oIndex += oldStatementsLength - 1;
        }
        if (newStatement && newStatement.length > 0) {
            if (!updatedStatements) {
                updatedStatements = [...statements];
            }
            updatedStatements.splice(uIndex, oldStatementsLength, ...newStatement);
            // When having more than a single new statement
            // we need to update the update Index
            uIndex += newStatement ? newStatement.length - 1 : 0;
        }
        const result = ts.visitNode(currentStatement, visitor);
        if (result !== currentStatement) {
            if (!updatedStatements) {
                updatedStatements = statements.slice();
            }
            updatedStatements[uIndex] = result;
        }
    }
    // if changes, return updated statements
    // otherwise, return original array instance
    return updatedStatements ? nodeFactory.createNodeArray(updatedStatements) : statements;
}
// TS 2.3 enums have statements that are inside a IIFE.
function findEnumIife(name, statement) {
    if (!ts.isExpressionStatement(statement)) {
        return null;
    }
    const expression = statement.expression;
    if (!expression || !ts.isCallExpression(expression) || expression.arguments.length !== 1) {
        return null;
    }
    const callExpression = expression;
    let exportExpression;
    if (!ts.isParenthesizedExpression(callExpression.expression)) {
        return null;
    }
    const functionExpression = callExpression.expression.expression;
    if (!ts.isFunctionExpression(functionExpression)) {
        return null;
    }
    // The name of the parameter can be different than the name of the enum if it was renamed
    // due to scope hoisting.
    const parameter = functionExpression.parameters[0];
    if (!ts.isIdentifier(parameter.name)) {
        return null;
    }
    const parameterName = parameter.name.text;
    let argument = callExpression.arguments[0];
    if (!ts.isBinaryExpression(argument) ||
        !ts.isIdentifier(argument.left) ||
        argument.left.text !== name) {
        return null;
    }
    let potentialExport = false;
    if (argument.operatorToken.kind === ts.SyntaxKind.FirstAssignment) {
        if (ts.isBinaryExpression(argument.right) &&
            argument.right.operatorToken.kind !== ts.SyntaxKind.BarBarToken) {
            return null;
        }
        potentialExport = true;
        argument = argument.right;
    }
    if (!ts.isBinaryExpression(argument)) {
        return null;
    }
    if (argument.operatorToken.kind !== ts.SyntaxKind.BarBarToken) {
        return null;
    }
    if (potentialExport && !ts.isIdentifier(argument.left)) {
        exportExpression = argument.left;
    }
    // Go through all the statements and check that all match the name
    for (const statement of functionExpression.body.statements) {
        if (!ts.isExpressionStatement(statement) ||
            !ts.isBinaryExpression(statement.expression) ||
            !ts.isElementAccessExpression(statement.expression.left)) {
            return null;
        }
        const leftExpression = statement.expression.left.expression;
        if (!ts.isIdentifier(leftExpression) || leftExpression.text !== parameterName) {
            return null;
        }
    }
    return [callExpression, exportExpression];
}
function updateHostNode(nodeFactory, hostNode, expression) {
    // Update existing host node with the pure comment before the variable declaration initializer.
    const variableDeclaration = hostNode.declarationList.declarations[0];
    const outerVarStmt = nodeFactory.updateVariableStatement(hostNode, hostNode.modifiers, nodeFactory.updateVariableDeclarationList(hostNode.declarationList, [
        nodeFactory.updateVariableDeclaration(variableDeclaration, variableDeclaration.name, variableDeclaration.exclamationToken, variableDeclaration.type, expression),
    ]));
    return outerVarStmt;
}
/**
 * Find enums, class expression or declaration statements.
 *
 * The classExpressions block to wrap in an iife must
 * - end with an ExpressionStatement
 * - it's expression must be a BinaryExpression
 * - have the same name
 *
 * ```
 let Foo = class Foo {};
 Foo = __decorate([]);
 ```
 */
function findStatements(name, statements, statementIndex, offset = 0) {
    let count = 1;
    for (let index = statementIndex + 1; index < statements.length; ++index) {
        const statement = statements[index];
        if (!ts.isExpressionStatement(statement)) {
            break;
        }
        const expression = statement.expression;
        if (ts.isCallExpression(expression)) {
            // Ex:
            // setClassMetadata(FooClass, [{}], void 0);
            // __decorate([propDecorator()], FooClass.prototype, "propertyName", void 0);
            // __decorate([propDecorator()], FooClass, "propertyName", void 0);
            // __decorate$1([propDecorator()], FooClass, "propertyName", void 0);
            const args = expression.arguments;
            if (args.length > 2) {
                const isReferenced = args.some((arg) => {
                    const potentialIdentifier = ts.isPropertyAccessExpression(arg) ? arg.expression : arg;
                    return ts.isIdentifier(potentialIdentifier) && potentialIdentifier.text === name;
                });
                if (isReferenced) {
                    count++;
                    continue;
                }
            }
        }
        else if (ts.isBinaryExpression(expression)) {
            const node = ts.isBinaryExpression(expression.left) ? expression.left.left : expression.left;
            const leftExpression = ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
                ? // Static Properties // Ex: Foo.bar = 'value';
                    // ENUM Property // Ex:  ChangeDetectionStrategy[ChangeDetectionStrategy.Default] = "Default";
                    node.expression
                : // Ex: FooClass = __decorate([Component()], FooClass);
                    node;
            if (ts.isIdentifier(leftExpression) && leftExpression.text === name) {
                count++;
                continue;
            }
        }
        break;
    }
    if (count > 1) {
        return statements.slice(statementIndex + offset, statementIndex + count);
    }
    return undefined;
}
function updateEnumIife(nodeFactory, hostNode, iife, exportAssignment) {
    if (!ts.isParenthesizedExpression(iife.expression) ||
        !ts.isFunctionExpression(iife.expression.expression)) {
        throw new Error('Invalid IIFE Structure');
    }
    // Ignore export assignment if variable is directly exported
    if (hostNode.modifiers &&
        hostNode.modifiers.findIndex((m) => m.kind == ts.SyntaxKind.ExportKeyword) != -1) {
        exportAssignment = undefined;
    }
    const expression = iife.expression.expression;
    const updatedFunction = nodeFactory.updateFunctionExpression(expression, expression.modifiers, expression.asteriskToken, expression.name, expression.typeParameters, expression.parameters, expression.type, nodeFactory.updateBlock(expression.body, [
        ...expression.body.statements,
        nodeFactory.createReturnStatement(expression.parameters[0].name),
    ]));
    let arg = nodeFactory.createObjectLiteralExpression();
    if (exportAssignment) {
        arg = nodeFactory.createBinaryExpression(exportAssignment, ts.SyntaxKind.BarBarToken, arg);
    }
    const updatedIife = nodeFactory.updateCallExpression(iife, nodeFactory.updateParenthesizedExpression(iife.expression, updatedFunction), iife.typeArguments, [arg]);
    let value = (0, ast_utils_1.addPureComment)(updatedIife);
    if (exportAssignment) {
        value = nodeFactory.createBinaryExpression(exportAssignment, ts.SyntaxKind.FirstAssignment, updatedIife);
    }
    return [updateHostNode(nodeFactory, hostNode, value)];
}
function createWrappedClass(nodeFactory, hostNode, statements) {
    const name = hostNode.name.text;
    const updatedStatements = [...statements];
    if (ts.isClassDeclaration(hostNode)) {
        updatedStatements[0] = nodeFactory.createClassDeclaration(hostNode.decorators, undefined, hostNode.name, hostNode.typeParameters, hostNode.heritageClauses, hostNode.members);
    }
    const pureIife = (0, ast_utils_1.addPureComment)(nodeFactory.createImmediatelyInvokedArrowFunction([
        ...updatedStatements,
        nodeFactory.createReturnStatement(nodeFactory.createIdentifier(name)),
    ]));
    const modifiers = hostNode.modifiers;
    const isDefault = !!modifiers && modifiers.some((x) => x.kind === ts.SyntaxKind.DefaultKeyword);
    const newStatement = [];
    newStatement.push(nodeFactory.createVariableStatement(isDefault ? undefined : modifiers, nodeFactory.createVariableDeclarationList([nodeFactory.createVariableDeclaration(name, undefined, undefined, pureIife)], ts.NodeFlags.Let)));
    if (isDefault) {
        newStatement.push(nodeFactory.createExportAssignment(undefined, undefined, false, nodeFactory.createIdentifier(name)));
    }
    return newStatement;
}
