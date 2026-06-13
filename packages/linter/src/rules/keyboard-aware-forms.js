"use strict";

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Forms with multiple TextInput components should be wrapped in KeyboardAwareFormContainer from @supa-media/core/forms.",
      recommended: true,
    },
    messages: {
      missingKeyboardAware:
        "Component '{{name}}' renders {{count}} TextInput elements but is not wrapped in KeyboardAwareFormContainer. Import KeyboardAwareFormContainer from '@supa-media/core/forms' and wrap the form content to ensure proper keyboard handling.",
    },
    schema: [
      {
        type: "object",
        properties: {
          minInputs: { type: "number", minimum: 1 },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] || {};
    const minInputs = options.minInputs || 2;

    let hasKeyboardAwareImport = false;

    /**
     * Count TextInput JSX elements inside a given AST node.
     */
    function countTextInputs(node) {
      let count = 0;
      traverseJSX(node, (jsxNode) => {
        if (
          jsxNode.type === "JSXOpeningElement" &&
          getElementName(jsxNode.name) === "TextInput"
        ) {
          count++;
        }
      });
      return count;
    }

    /**
     * Check whether the JSX tree contains a KeyboardAwareFormContainer wrapper.
     */
    function hasKeyboardAwareWrapper(node) {
      let found = false;
      traverseJSX(node, (jsxNode) => {
        if (
          jsxNode.type === "JSXOpeningElement" &&
          getElementName(jsxNode.name) === "KeyboardAwareFormContainer"
        ) {
          found = true;
        }
      });
      return found;
    }

    /**
     * Walk all child nodes looking for JSX elements.
     */
    function traverseJSX(node, callback) {
      if (!node || typeof node !== "object") return;
      if (node.type && node.type.startsWith("JSX")) {
        callback(node);
      }
      for (const key of Object.keys(node)) {
        if (key === "parent") continue;
        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach((c) => traverseJSX(c, callback));
        } else if (child && typeof child === "object" && child.type) {
          traverseJSX(child, callback);
        }
      }
    }

    /**
     * Extract the element name string from a JSXIdentifier or JSXMemberExpression.
     */
    function getElementName(nameNode) {
      if (!nameNode) return "";
      if (nameNode.type === "JSXIdentifier") return nameNode.name;
      if (nameNode.type === "JSXMemberExpression") {
        return getElementName(nameNode.property);
      }
      return "";
    }

    /**
     * Get the component name from a function/arrow function node or its parent.
     */
    function getComponentName(node) {
      // Named function declaration
      if (node.type === "FunctionDeclaration" && node.id) {
        return node.id.name;
      }
      // Arrow function or function expression assigned to a variable
      if (
        node.parent &&
        node.parent.type === "VariableDeclarator" &&
        node.parent.id
      ) {
        return node.parent.id.name;
      }
      return "Anonymous";
    }

    /**
     * Check a component's return statements for form patterns.
     */
    function checkComponent(node) {
      if (hasKeyboardAwareImport) return;

      const body = node.body;
      if (!body) return;

      // For arrow functions with expression body (direct JSX return)
      if (body.type === "JSXElement" || body.type === "JSXFragment") {
        const inputCount = countTextInputs(body);
        if (inputCount >= minInputs && !hasKeyboardAwareWrapper(body)) {
          context.report({
            node,
            messageId: "missingKeyboardAware",
            data: {
              name: getComponentName(node),
              count: String(inputCount),
            },
          });
        }
        return;
      }

      // For block body, check return statements
      if (body.type === "BlockStatement") {
        for (const stmt of body.body) {
          if (stmt.type === "ReturnStatement" && stmt.argument) {
            const arg = stmt.argument;
            if (
              arg.type === "JSXElement" ||
              arg.type === "JSXFragment" ||
              arg.type === "ParenthesizedExpression"
            ) {
              const inputCount = countTextInputs(arg);
              if (inputCount >= minInputs && !hasKeyboardAwareWrapper(arg)) {
                context.report({
                  node,
                  messageId: "missingKeyboardAware",
                  data: {
                    name: getComponentName(node),
                    count: String(inputCount),
                  },
                });
                return;
              }
            }
          }
        }
      }
    }

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (
          source === "@supa-media/core/forms" ||
          source.includes("KeyboardAwareFormContainer")
        ) {
          for (const spec of node.specifiers) {
            if (
              spec.type === "ImportSpecifier" &&
              (spec.imported.name === "KeyboardAwareFormContainer" ||
                spec.local.name === "KeyboardAwareFormContainer")
            ) {
              hasKeyboardAwareImport = true;
            }
          }
        }
      },
      FunctionDeclaration: checkComponent,
      ArrowFunctionExpression: checkComponent,
      FunctionExpression: checkComponent,
    };
  },
};
