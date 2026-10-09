const { criarApp } = require('./app');

const porta = Number(process.env.PORT) || 3000;

criarApp().listen(porta, () => {
  console.log(`Monitor de Integração rodando em http://localhost:${porta}`);
  console.log(`Documentação da API: http://localhost:${porta}/docs`);
});
