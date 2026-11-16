'use strict';

// Fonte única da versão do Agent: o package.json.
// Funciona no Electron empacotado (package.json fica na raiz do app.asar)
// e no `npm run server-only`. Nunca ler versão do config.json do usuário.
module.exports = { VERSION: require('../package.json').version };
