import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { appPublicEntries } from '../.eslint/feature-entrypoints.mjs';

const requiredDirectories = ['app', 'app/components', 'app/hooks', 'app/lib', 'app/data'];
const reactSourceRoots = ['app', 'test', 'e2e', 'visualTests'];
const testPlacementRoots = ['app', 'test', 'e2e', 'visualTests', 'scripts', 'native', 'supabase'];
const legacyRootNames = new Map([
  ['app', 'app'],
  ['components', 'app/components'],
  ['lib', 'app/lib'],
  ['hooks', 'app/hooks'],
  ['data', 'app/data'],
  ['test', 'test'],
  ['tests', 'test'],
  ['e2e', 'e2e'],
  ['android-test', 'test/android'],
  ['android-e2e', 'e2e/android'],
  ['visualtests', 'visualTests'],
  ['visual-tests', 'visualTests'],
]);
const legacyRootFiles = new Map([
  ['app.tsx', 'App.tsx'],
  ['app.jsx', 'App.jsx'],
  ['constants.ts', 'app/constants.ts'],
  ['index.css', 'app/index.css'],
  ['index.tsx', 'app/index.tsx'],
  ['types.ts', 'app/types.ts'],
]);
const componentSourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx']);
const indexFileNames = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'];
const ignoredSourceDirectories = new Set(['__tests__']);
const ignoredGeneratedDirectories = new Set([
  '.git', '.gradle', '.vite', 'build', 'dist', 'node_modules', 'test-results',
]);

function isTestSpecFileName(fileName) {
  return /(?:^test_[^.].*|\.(?:test|spec|e2e|visual)\.[^.]+$|Tests?\.(?:[jt]sx?|java|kt)$)/i.test(fileName);
}

function isDirectory(directoryPath) {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function toRepositoryPath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function walkSourceFiles(directoryPath, callback) {
  let entries;
  try {
    entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const childPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredSourceDirectories.has(entry.name) && !ignoredGeneratedDirectories.has(entry.name)) {
        walkSourceFiles(childPath, callback);
      }
      continue;
    }

    const extension = path.extname(entry.name);
    if (!componentSourceExtensions.has(extension)) continue;
    if (isTestSpecFileName(entry.name)) continue;
    callback(childPath);
  }
}

function createSourceFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function containsJsx(node) {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return true;
  return ts.forEachChild(node, containsJsx) ?? false;
}

function hasModifier(node, modifierKind) {
  return node.modifiers?.some(modifier => modifier.kind === modifierKind) ?? false;
}

function isComponentName(name) {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

function componentNameFromDeclaration(statement) {
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
    return statement.name?.text;
  }

  return undefined;
}

function componentDeclarations(sourceFile) {
  const components = [];

  for (const statement of sourceFile.statements) {
    const declaredName = componentNameFromDeclaration(statement);
    if (declaredName && isComponentName(declaredName) && isReactComponentClassOrFunction(statement)) {
      components.push({ name: declaredName, declaration: statement });
      continue;
    }

    if (!ts.isVariableStatement(statement)) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      if (!isComponentName(declaration.name.text) || !isReactComponentVariable(declaration)) continue;
      components.push({ name: declaration.name.text, declaration: statement });
    }
  }

  for (const statement of sourceFile.statements) {
    if (!ts.isExportAssignment(statement) || !isReactComponentExpression(statement.expression)) continue;
    const exportedWrapperReferences = wrappedComponentReferences(statement.expression);
    if (components.some(component => exportedWrapperReferences.includes(component.name))) continue;
    components.push({ name: 'default export', declaration: statement });
  }

  return components;
}

function typeReferenceName(typeNode) {
  if (!typeNode || !ts.isTypeReferenceNode(typeNode)) return undefined;
  return ts.isIdentifier(typeNode.typeName) ? typeNode.typeName.text : typeNode.typeName.right.text;
}

function isReactFunctionType(typeNode) {
  const name = typeReferenceName(typeNode);
  return name === 'FC' || name === 'FunctionComponent';
}

function reactWrapperName(expression) {
  if (!ts.isCallExpression(expression)) return undefined;
  const callee = expression.expression;
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
  return name === 'memo' || name === 'forwardRef' ? name : undefined;
}

function wrappedComponentReferences(expression) {
  if (!reactWrapperName(expression)) return [];
  return expression.arguments.flatMap(argument => {
    if (ts.isIdentifier(argument)) return [argument.text];
    return wrappedComponentReferences(argument);
  });
}

function isReactComponentExpression(expression) {
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    return containsJsx(expression) || isReactFunctionType(expression.type);
  }
  return reactWrapperName(expression) !== undefined;
}

function isReactComponentVariable(declaration) {
  if ((ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) &&
      containsJsx(declaration.initializer)) return true;
  if (isReactFunctionType(declaration.type)) return true;
  return reactWrapperName(declaration.initializer) !== undefined;
}

function isReactComponentClassOrFunction(statement) {
  if (containsJsx(statement)) return true;
  if (!ts.isClassDeclaration(statement)) return false;
  return statement.heritageClauses?.some(clause => clause.types.some(type => {
    const expression = type.expression;
    const name = ts.isIdentifier(expression)
      ? expression.text
      : ts.isPropertyAccessExpression(expression) ? expression.name.text : undefined;
    return name === 'Component' || name === 'PureComponent';
  })) ?? false;
}

function resolveModulePath(importerPath, specifier) {
  const basePath = path.resolve(path.dirname(importerPath), specifier);
  const candidates = [
    basePath,
    ...[...componentSourceExtensions].map(extension => `${basePath}${extension}`),
    ...indexFileNames.map(fileName => path.join(basePath, fileName)),
  ];

  return candidates.find(candidate => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

function sourceHasDefaultComponent(sourceFile, component) {
  if (component.name === 'default export') {
    return sourceFile.statements.some(statement =>
      ts.isExportAssignment(statement) && !statement.isExportEquals && isReactComponentExpression(statement.expression));
  }

  const declaration = component.declaration;
  if ((ts.isFunctionDeclaration(declaration) || ts.isClassDeclaration(declaration)) &&
      hasModifier(declaration, ts.SyntaxKind.DefaultKeyword)) return true;

  if (ts.isVariableStatement(declaration) && hasModifier(declaration, ts.SyntaxKind.DefaultKeyword)) return true;

  return sourceFile.statements.some(statement => {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      if (ts.isIdentifier(statement.expression) && statement.expression.text === component.name) return true;
      if (wrappedComponentReferences(statement.expression).includes(component.name)) return true;
    }
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier || !statement.exportClause ||
        !ts.isNamedExports(statement.exportClause)) return false;
    return statement.exportClause.elements.some(specifier =>
      !specifier.isTypeOnly && specifier.name.text === 'default' &&
      (specifier.propertyName?.text ?? specifier.name.text) === component.name);
  });
}

function sourceExportsName(sourceFile, component, exportedName) {
  if (component.name === 'default export') return exportedName === 'default' && sourceHasDefaultComponent(sourceFile, component);
  if (exportedName === 'default') return sourceHasDefaultComponent(sourceFile, component);

  const declaration = component.declaration;
  const isExportedByModifier = (ts.isFunctionDeclaration(declaration) || ts.isClassDeclaration(declaration))
    ? hasModifier(declaration, ts.SyntaxKind.ExportKeyword) && !hasModifier(declaration, ts.SyntaxKind.DefaultKeyword)
    : ts.isVariableStatement(declaration) && hasModifier(declaration, ts.SyntaxKind.ExportKeyword) &&
      !hasModifier(declaration, ts.SyntaxKind.DefaultKeyword);
  if (isExportedByModifier && component.name === exportedName) return true;

  return sourceFile.statements.some(statement => {
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier || !statement.exportClause ||
        !ts.isNamedExports(statement.exportClause)) return false;
    return statement.exportClause.elements.some(specifier =>
      !specifier.isTypeOnly && specifier.name.text === exportedName &&
      (specifier.propertyName?.text ?? specifier.name.text) === component.name);
  });
}

function indexExportsComponent(indexPath, componentPath, component) {
  const indexFile = createSourceFile(indexPath);
  const componentFile = path.resolve(componentPath);
  const localImports = new Map();

  for (const statement of indexFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.importClause?.isTypeOnly) continue;
    const resolved = resolveModulePath(indexPath, statement.moduleSpecifier.text);
    if (!resolved || path.resolve(resolved) !== componentFile) continue;

    const importClause = statement.importClause;
    if (importClause?.name) localImports.set(importClause.name.text, 'default');
    if (importClause?.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
      for (const specifier of importClause.namedBindings.elements) {
        if (specifier.isTypeOnly) continue;
        localImports.set(specifier.name.text, specifier.propertyName?.text ?? specifier.name.text);
      }
    }
  }

  for (const statement of indexFile.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause &&
        ts.isNamedExports(statement.exportClause) && statement.exportClause.elements.length > 0) {
      const resolved = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? resolveModulePath(indexPath, statement.moduleSpecifier.text)
        : undefined;

      for (const specifier of statement.exportClause.elements) {
        if (specifier.isTypeOnly || specifier.name.text !== 'default') continue;
        const originalName = specifier.propertyName?.text ?? specifier.name.text;
        if (resolved && path.resolve(resolved) === componentFile &&
            sourceExportsName(createSourceFile(componentFile), component, originalName)) return true;
        if (!resolved && path.resolve(indexPath) === componentFile &&
            ((specifier.name.text === 'default' && originalName === component.name &&
              sourceHasDefaultComponent(indexFile, component)) ||
              sourceExportsName(indexFile, component, originalName))) return true;

        const importedName = localImports.get(originalName);
        if (!resolved && importedName && sourceExportsName(createSourceFile(componentFile), component, importedName)) return true;
      }
    }

    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const sourceComponent = createSourceFile(componentFile);
      const exportsImportedComponent = expression => {
        if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
            ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)) {
          return exportsImportedComponent(expression.expression);
        }
        if (ts.isIdentifier(expression)) {
          const importedName = localImports.get(expression.text);
          return importedName !== undefined && sourceExportsName(sourceComponent, component, importedName);
        }
        if (!reactWrapperName(expression)) return false;
        return expression.arguments.some(exportsImportedComponent);
      };
      if (exportsImportedComponent(statement.expression)) return true;

      if (path.resolve(indexPath) === componentFile && ts.isIdentifier(statement.expression) &&
          statement.expression.text === component.name &&
          sourceHasDefaultComponent(indexFile, component)) return true;
    }

    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
        statement.name?.text === component.name && path.resolve(indexPath) === componentFile &&
        hasModifier(statement, ts.SyntaxKind.DefaultKeyword) && containsJsx(statement)) return true;
  }

  return false;
}

function hasDualNamedAndDefaultExport(sourceFile) {
  const exportedNamesByBinding = new Map();
  const addExport = (binding, exportedName) => {
    const names = exportedNamesByBinding.get(binding) ?? new Set();
    names.add(exportedName);
    exportedNamesByBinding.set(binding, names);
  };

  for (const statement of sourceFile.statements) {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
        statement.name) {
      if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
        addExport(`local:${statement.name.text}`, 'default');
      } else if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
        addExport(`local:${statement.name.text}`, statement.name.text);
      }
    }
    if (ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
          addExport(`local:${declaration.name.text}`, 'default');
        } else {
          addExport(`local:${declaration.name.text}`, declaration.name.text);
        }
      }
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals && ts.isIdentifier(statement.expression)) {
      addExport(`local:${statement.expression.text}`, 'default');
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const specifier of statement.exportClause.elements) {
        if (specifier.isTypeOnly) continue;
        const importedName = specifier.propertyName?.text ?? specifier.name.text;
        const moduleName = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
          ? `module:${statement.moduleSpecifier.text}:`
          : 'local:';
        addExport(`${moduleName}${importedName}`, specifier.name.text);
      }
    }
  }

  return [...exportedNamesByBinding.entries()].find(([, names]) =>
    names.has('default') && [...names].some(name => name !== 'default'))?.[0].replace(/^local:/, '');
}

function walkAllFiles(directoryPath, callback) {
  let entries;
  try {
    entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const childPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredGeneratedDirectories.has(entry.name)) walkAllFiles(childPath, callback);
      continue;
    }
    if (entry.isFile()) callback(childPath);
  }
}

function hasAuthoredContent(directoryPath) {
  let found = false;
  walkAllFiles(directoryPath, filePath => {
    if (found) return;
    const extension = path.extname(filePath).toLowerCase();
    if (componentSourceExtensions.has(extension) || ['.java', '.kt', '.py'].includes(extension) ||
        isTestSpecFileName(path.basename(filePath))) found = true;
  });
  return found;
}

function checkComponentSources(root, diagnostics) {
  for (const sourceRoot of reactSourceRoots) {
    const sourcePath = path.join(root, sourceRoot);
    if (!isDirectory(sourcePath)) continue;

    walkSourceFiles(sourcePath, filePath => {
      const sourceFile = createSourceFile(filePath);
      const relativeFile = toRepositoryPath(root, filePath);
      const dualExportBinding = hasDualNamedAndDefaultExport(sourceFile);
      if (dualExportBinding) {
        diagnostics.push({
          file: relativeFile,
          message: `Do not export ${dualExportBinding} as both a named and default export.`,
        });
      }

      const components = componentDeclarations(sourceFile);
      if (components.length > 1) {
        diagnostics.push({
          file: relativeFile,
          message: `A component file may define only one top-level React component; found ${components.length}: ${components.map(component => component.name).join(', ')}.`,
        });
      }

      for (const component of components) {
        if (component.name !== 'App') continue;
        if (!['App.tsx', 'App.jsx'].some(fileName => path.resolve(filePath) === path.resolve(root, fileName))) {
          diagnostics.push({ file: relativeFile, message: 'The App component belongs in a repository-root App.tsx or App.jsx file.' });
        }
      }
    });
  }

  const appPaths = ['App.tsx', 'App.jsx'].map(fileName => path.join(root, fileName))
    .filter(appPath => fs.existsSync(appPath));
  if (appPaths.length === 0) {
    diagnostics.push({ file: 'App.tsx', message: 'A repository-root App.tsx or App.jsx file is required.' });
  } else if (appPaths.length > 1) {
    diagnostics.push({ file: 'App.tsx', message: 'Keep one repository-root App file, either App.tsx or App.jsx.' });
  }
  for (const appPath of appPaths) {
    const appFile = createSourceFile(appPath);
    const appComponent = componentDeclarations(appFile).find(component => component.name === 'App');
    if (!appComponent || !sourceHasDefaultComponent(appFile, appComponent)) {
      diagnostics.push({ file: toRepositoryPath(root, appPath), message: 'The repository-root App component must be the default export.' });
    }
  }

  if (!fs.existsSync(path.join(root, 'app/index.tsx'))) {
    diagnostics.push({ file: 'app/index.tsx', message: 'The browser bootstrap belongs in app/index.tsx.' });
  }
}

function directSourceFiles(directoryPath) {
  try {
    return fs.readdirSync(directoryPath, { withFileTypes: true })
      .filter(entry => entry.isFile() && componentSourceExtensions.has(path.extname(entry.name)) &&
        !isTestSpecFileName(entry.name))
      .map(entry => path.join(directoryPath, entry.name));
  } catch {
    return [];
  }
}

function componentImplementationForFolder(directoryPath) {
  const folderName = path.basename(directoryPath);
  for (const filePath of directSourceFiles(directoryPath)) {
    if (path.basename(filePath, path.extname(filePath)).toLowerCase() !== folderName.toLowerCase()) continue;
    const sourceFile = createSourceFile(filePath);
    const component = componentDeclarations(sourceFile).find(candidate =>
      candidate.name === folderName || candidate.name.toLowerCase() === folderName.toLowerCase() ||
      candidate.name === 'default export');
    if (component) return { filePath, sourceFile, component };
  }
  return undefined;
}

function isWithinDirectory(directoryPath, candidatePath) {
  const relative = path.relative(directoryPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveRuntimeModule(root, importerPath, specifier) {
  const basePath = specifier.startsWith('@/')
    ? path.resolve(root, specifier.slice(2))
    : specifier.startsWith('.') ? path.resolve(path.dirname(importerPath), specifier) : undefined;
  if (!basePath) return undefined;

  const candidates = [
    basePath,
    ...[...componentSourceExtensions].map(extension => `${basePath}${extension}`),
    ...indexFileNames.map(fileName => path.join(basePath, fileName)),
  ];
  return candidates.find(candidate => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

function isRuntimeImportDeclaration(node) {
  const clause = node.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name) return true;
  if (!clause.namedBindings) return true;
  if (ts.isNamespaceImport(clause.namedBindings)) return true;
  return clause.namedBindings.elements.some(specifier => !specifier.isTypeOnly);
}

function runtimeImportSpecifiers(sourceFile) {
  const specifiers = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && isRuntimeImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier)) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }

  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        ts.isStringLiteralLike(node.arguments[0])) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  for (const statement of sourceFile.statements) visit(statement);
  return specifiers;
}

function defaultExportSpecifier(sourceFile) {
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier ||
        !ts.isStringLiteral(statement.moduleSpecifier) || !statement.exportClause ||
        !ts.isNamedExports(statement.exportClause)) continue;
    if (statement.exportClause.elements.some(specifier =>
      !specifier.isTypeOnly && specifier.name.text === 'default')) return statement.moduleSpecifier.text;
  }
  return undefined;
}

function normalizedRepositoryModulePath(root, filePath) {
  return toRepositoryPath(root, filePath)
    .replace(/\.(?:tsx?|jsx?)$/, '')
    .replace(/\/index$/, '');
}

function checkRuntimeChildOwnership(root, diagnostics) {
  const componentsRoot = path.join(root, 'app/components');
  if (!isDirectory(componentsRoot)) return;

  const componentModules = new Map();
  const componentEntryModules = new Map();
  const ownerDirectories = new Map();
  const publicComponentModules = new Set();
  const allSourceFiles = [];

  walkSourceFiles(componentsRoot, filePath => {
    allSourceFiles.push(filePath);
    const declarations = componentDeclarations(createSourceFile(filePath));
    if (declarations.length === 1) {
      const component = declarations[0];
      const name = component.name === 'default export'
        ? path.basename(filePath, path.extname(filePath))
        : component.name;
      componentModules.set(path.resolve(filePath), { name, filePath });
    }
  });

  const visitFolders = directoryPath => {
    let entries;
    try {
      entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || ignoredGeneratedDirectories.has(entry.name) || ignoredSourceDirectories.has(entry.name)) continue;
      const childDirectory = path.join(directoryPath, entry.name);
      const implementation = componentImplementationForFolder(childDirectory);
      if (implementation) {
        const indexPath = indexFileNames.map(fileName => path.join(childDirectory, fileName)).find(candidate => {
          try {
            return fs.statSync(candidate).isFile();
          } catch {
            return false;
          }
        });
        if (indexPath) {
          const implementationPath = path.resolve(implementation.filePath);
          componentEntryModules.set(path.resolve(indexPath), implementationPath);
          ownerDirectories.set(implementationPath, childDirectory);
        }
      }
      visitFolders(childDirectory);
    }
  };
  visitFolders(componentsRoot);

  const indexFiles = allSourceFiles.filter(filePath => /^index\.[^.]+$/.test(path.basename(filePath)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const indexPath of indexFiles) {
      if (componentEntryModules.has(path.resolve(indexPath))) continue;
      const specifier = defaultExportSpecifier(createSourceFile(indexPath));
      if (!specifier) continue;
      const resolvedPath = resolveModulePath(indexPath, specifier);
      if (!resolvedPath) continue;
      const resolved = path.resolve(resolvedPath);
      const targetPath = componentModules.has(resolved) ? resolved : componentEntryModules.get(resolved);
      if (!targetPath) continue;
      componentEntryModules.set(path.resolve(indexPath), targetPath);
      const entryName = normalizedRepositoryModulePath(root, path.dirname(indexPath));
      if (appPublicEntries.has(entryName)) publicComponentModules.add(targetPath);
      changed = true;
    }
  }

  const runtimeConsumers = new Map();
  for (const importerPath of allSourceFiles) {
    const importerComponents = componentDeclarations(createSourceFile(importerPath));
    if (importerComponents.length !== 1) continue;
    const importerInfo = componentModules.get(path.resolve(importerPath));
    if (!importerInfo) continue;
    const sourceFile = createSourceFile(importerPath);

    for (const specifier of new Set(runtimeImportSpecifiers(sourceFile))) {
      const resolvedPath = resolveRuntimeModule(root, importerPath, specifier);
      if (!resolvedPath) continue;
      const resolved = path.resolve(resolvedPath);
      const targetPath = componentModules.has(resolved) ? resolved : componentEntryModules.get(resolved);
      if (!targetPath) continue;

      const targetInfo = componentModules.get(targetPath);
      if (!targetInfo) continue;
      const targetModuleName = normalizedRepositoryModulePath(root, targetPath);
      const targetOwnerDirectory = ownerDirectories.get(targetPath);
      const targetOwnerName = targetOwnerDirectory
        ? normalizedRepositoryModulePath(root, targetOwnerDirectory)
        : undefined;
      if (targetModuleName.startsWith('app/components/common/')) continue;
      if (publicComponentModules.has(targetPath) || appPublicEntries.has(targetModuleName) ||
          (targetOwnerName && appPublicEntries.has(targetOwnerName))) continue;

      const consumers = runtimeConsumers.get(targetPath) ?? new Map();
      consumers.set(importerPath, importerInfo);
      runtimeConsumers.set(targetPath, consumers);
    }
  }

  for (const [targetPath, consumers] of runtimeConsumers) {
    if (consumers.size !== 1) continue;
    const [importerPath, importerInfo] = consumers.entries().next().value;
    const targetInfo = componentModules.get(targetPath);
    if (!targetInfo) continue;

    const importerModule = path.resolve(importerPath);
    const parentDirectory = ownerDirectories.get(importerModule) ??
      path.join(path.dirname(importerModule), importerInfo.name);
    if (isWithinDirectory(parentDirectory, targetPath)) continue;

    diagnostics.push({
      file: toRepositoryPath(root, targetPath),
      message: `Private component ${targetInfo.name} has one runtime component consumer (${importerInfo.name}); place it under ${toRepositoryPath(root, parentDirectory)}.`,
    });
  }
}

function hasChildComponent(directoryPath, implementationPath, componentName) {
  let found = false;
  walkSourceFiles(directoryPath, filePath => {
    if (found || path.resolve(filePath) === path.resolve(implementationPath)) return;
    found = componentDeclarations(createSourceFile(filePath)).some(component => component.name !== componentName);
  });
  return found;
}

function checkComponentFolders(root, diagnostics) {
  const componentsRoot = path.join(root, 'app/components');
  const visit = directoryPath => {
    let entries;
    try {
      entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || ignoredGeneratedDirectories.has(entry.name) || ignoredSourceDirectories.has(entry.name)) continue;
      const childDirectory = path.join(directoryPath, entry.name);
      const implementation = componentImplementationForFolder(childDirectory);
      const relativeDirectory = toRepositoryPath(root, childDirectory);

      if (implementation) {
        const componentName = implementation.component.name === 'default export'
          ? path.basename(implementation.filePath, path.extname(implementation.filePath))
          : implementation.component.name;
        if (entry.name !== componentName || !isComponentName(entry.name)) {
          diagnostics.push({
            file: relativeDirectory,
            message: `A component owner folder must use the PascalCase component name ${componentName}.`,
          });
        }

        const childExists = hasChildComponent(childDirectory, implementation.filePath, componentName);
        if (!childExists) {
          diagnostics.push({
            file: relativeDirectory,
            message: `Flatten ${componentName}; a component folder is for a component with child components.`,
          });
        } else {
          const indexPath = indexFileNames.map(fileName => path.join(childDirectory, fileName)).find(candidate => {
            try {
              return fs.statSync(candidate).isFile();
            } catch {
              return false;
            }
          });
          if (!indexPath) {
            diagnostics.push({ file: relativeDirectory, message: `The ${componentName} component folder needs an index file.` });
          } else if (!indexExportsComponent(indexPath, implementation.filePath, implementation.component)) {
            diagnostics.push({
              file: toRepositoryPath(root, indexPath),
              message: `The component index must export ${componentName} from its implementation as the default.`,
            });
          }
        }
      } else if (/^[A-Z]/.test(entry.name)) {
        diagnostics.push({
          file: relativeDirectory,
          message: 'Structural folders use lowercase or camelCase names; PascalCase folders own components with child components.',
        });
      }

      visit(childDirectory);
    }
  };

  if (isDirectory(componentsRoot)) visit(componentsRoot);
}

function checkTestSpecLocations(root, diagnostics) {
  for (const sourceRoot of testPlacementRoots) {
    const sourcePath = path.join(root, sourceRoot);
    if (!isDirectory(sourcePath)) continue;

    walkAllFiles(sourcePath, filePath => {
      if (!isTestSpecFileName(path.basename(filePath))) return;
      const relativeFile = toRepositoryPath(root, filePath);
      if (!relativeFile.split('/').includes('__tests__')) {
        diagnostics.push({ file: relativeFile, message: 'Test and spec files must live under a __tests__ directory.' });
      }
    });
  }

  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isFile() && isTestSpecFileName(entry.name)) {
        diagnostics.push({ file: entry.name, message: 'Test and spec files must live under a __tests__ directory.' });
      }
    }
  } catch {
    return;
  }
}

export function checkReactStructure(root = process.cwd()) {
  const absoluteRoot = path.resolve(root);
  const diagnostics = [];

  for (const directory of requiredDirectories) {
    if (!isDirectory(path.join(absoluteRoot, directory))) {
      diagnostics.push({ file: directory, message: 'Required React structure directory is missing.' });
    }
  }

  const rootEntries = (() => {
    try {
      return fs.readdirSync(absoluteRoot, { withFileTypes: true });
    } catch {
      return [];
    }
  })();

  for (const entry of (() => {
    try {
      return fs.readdirSync(path.join(absoluteRoot, 'app'), { withFileTypes: true });
    } catch {
      return [];
    }
  })()) {
    if (entry.isDirectory() && entry.name.toLowerCase() === 'app') {
      diagnostics.push({ file: `app/${entry.name}`, message: 'Do not nest the app inside app/app.' });
    }
  }

  for (const entry of rootEntries) {
    const expectedName = legacyRootNames.get(entry.name.toLowerCase());
    if (entry.isDirectory() && expectedName && entry.name !== expectedName) {
      if (['android-test', 'android-e2e'].includes(entry.name.toLowerCase()) && !hasAuthoredContent(path.join(absoluteRoot, entry.name))) continue;
      diagnostics.push({
        file: entry.name,
        message: `Move authored source into the canonical ${expectedName} directory.`,
      });
    }

    const expectedFile = legacyRootFiles.get(entry.name.toLowerCase());
    if (entry.isFile() && expectedFile && !['App.tsx', 'App.jsx'].includes(entry.name)) {
      diagnostics.push({
        file: entry.name,
        message: `Move this app source file to ${expectedFile}.`,
      });
    }
  }

  checkComponentSources(absoluteRoot, diagnostics);
  checkComponentFolders(absoluteRoot, diagnostics);
  checkRuntimeChildOwnership(absoluteRoot, diagnostics);
  checkTestSpecLocations(absoluteRoot, diagnostics);
  diagnostics.sort((left, right) => left.file.localeCompare(right.file) || left.message.localeCompare(right.message));
  return diagnostics;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
  const root = process.argv[2] ?? process.cwd();
  const diagnostics = checkReactStructure(root);
  if (diagnostics.length === 0) {
    process.stdout.write('React structure check passed.\n');
  } else {
    for (const diagnostic of diagnostics) {
      process.stderr.write(`${diagnostic.file}: ${diagnostic.message}\n`);
    }
    process.exitCode = 1;
  }
}
