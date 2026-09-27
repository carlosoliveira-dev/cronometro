# Cronometro

Cronometro mobile-first com precisao de milissegundos. O servidor Go entrega a
pagina montada com `html/template`, o Tailwind CSS cuida da interface e toda a
contagem roda no cliente usando o relogio monotonico de `performance.now()`, o
que evita drift mesmo com a tela bloqueada ou a aba em segundo plano.

## Requisitos

- Go 1.26 ou superior
- Node.js 20 ou superior (apenas para compilar o CSS)

## Como rodar

```bash
npm install       # so na primeira vez, instala o @tailwindcss/cli
npm run build:css # gera static/dist/app.css
go run .
```

Acesse `http://localhost:8080`. Para trocar a porta ou os diretorios:

```bash
go run . -addr :3000 -v
```

O CSS compilado esta versionado no repositorio, entao `go run .` funciona sem
`npm install` desde que `static/dist/app.css` exista.

### Durante o desenvolvimento

Abra dois terminais na raiz do projeto:

```bash
npm run watch:css   # terminal 1: recompila o CSS ao salvar o template
go run . -v         # terminal 2: servidor
```

## Recursos

- Display `mm:ss.mmm` com os segundos destacados em cor de acento; minutos e
  milissegundos ficam apagados para a leitura do segundo dominar. Os milissegundos
  mudam a cada quadro (60 ou 120 Hz) e os segundos dao um pulso a cada virada.
- Iniciar, pausar, retomar e zerar, com atalhos de teclado.
- Voltas com tempo da volta (split), tempo acumulado, selo de melhor e pior volta.
- Edicao de uma volta registrada: o ajuste e redistribuido nas voltas seguintes
  para que o total da sessao nao mude, e nunca gera split negativo.
- Tela sempre ligada via Wake Lock API, com re-solicitacao ao voltar para a aba.
- Som (WebAudio, sem arquivos de audio) e vibracao no inicio, na parada e nas
  voltas, cada um com seu interruptor.
- Tema claro e escuro, respeitando a preferencia do sistema na primeira visita.
- Voltas e preferencias persistidas em `localStorage`; a sessao em andamento volta
  pausada no ultimo tempo registrado.

### Atalhos

| Tecla       | Acao                     |
| ----------- | ------------------------ |
| `Espaco`    | iniciar, pausar e retomar |
| `L`         | registrar volta          |
| `R`         | zerar                    |
| `Esc`       | fechar a edicao de volta |

## Estrutura

```
main.go              servidor, rotas e shutdown gracioso
main_test.go         testes de requisicao do servidor
templates/index.html pagina unica com o display e o dialogo de edicao
static/css/input.css fonte do Tailwind, com o tema e as animacoes proprias
static/dist/app.css  CSS compilado (versionado)
static/js/timer.js   logica pura: tempo, formatacao e matematica das voltas
static/js/app.js     DOM, eventos, persistencia, audio e wake lock
tests/timer.test.js  testes da logica pura com o runner nativo do Node
```

O limite de voltas guardadas vem do servidor (`maxLaps` em `main.go`, 5000 por
padrao). A interface desenha no maximo as 200 mais recentes para não pesar no
navegador do celular; o total e o melhor e pior considers todas as voltas.

## Testes

```bash
go test ./...   # servidor e headers
npm test        # logica do cronometro e das voltas
gofmt -l .      # deve sair vazio
go vet ./...
```

## Notas de implementacao

- O estado do cronometro e `acumulado + (performance.now() - marca)`, entao
  pausar, recarregar a pagina ou deixar o celular em repouso nao faz o tempo
  "andar" nem atrasar.
- O display so escreve no DOM os grupos que mudaram de valor, evitando
  recalcular layout a cada quadro.
- A renderizacao acontece em `requestAnimationFrame` e e reagendada ao voltar
  para a aba, o que mantem o valor correto sem trabalho em segundo plano.
- Editar ou apagar voltas nao afeta o relogio: a lista e um registro editado a
  parte, e apenas a soma dos splits e recalculada.
- O Wake Lock e solitado apenas por gesto do usuario; navegadores sem suporte
  (iOS Safari) escondem o interruptor.
- O corpo da pagina usa `min-height: 100svh` e a lista de voltas um
  `max-height: 42svh`. Com apenas `min-height` a lista cresce junto com o
  conteudo e a pagina inteira passa a rolar; com o teto na lista, a rolagem
  fica dentro dela e o corpo so cresce quando a tela e baixa demais para tudo
  caber, caso em que os botoes continuam alcancaveis.
- Os tamanhos do display usam `clamp` com `min(vw, vh)`, entao os segundos
  encolhem em paisagem (tela baixa) e em janelas estreitas de desktop, sem
  precisar de media queries por breakpoint.
- Em telas com menos de 520px de altura o resumo de melhor e pior volta e
  escondido, e esses selos continuam visiveis em cada linha da lista.
- O `Cache-Control` dos assets e `no-cache`: o `http.FileServer` do Go envia
  `Last-Modified`, entao o navegador revalida e recebe 304 quando nada mudou,
  sem nunca servir um JavaScript antigo em desenvolvimento.

## Verificacao feita

- `go test ./...`: rotas, headers, redirecionamento de favicon e metodo bloqueado.
- `npm test`: 30 testes da logica de tempo e voltas, mais uma verificacao de que
  toda classe usada no template existe no CSS compilado.
- Fluxo completo no navegador (Edge headless via CDP): iniciar, pausar, retomar,
  registrar voltas, selos de melhor e pior, edicao com validacao, exclusao,
  persistencia em `localStorage`, troca de tema e atalhos de teclado, sem nenhum
  erro de console.
- Auditoria de layout em 6 viewports (320x568, 360x640, 390x844, 1280x800,
  844x390 e 420x520): sem estouro horizontal, sem colisao entre blocos, botoes
  com 44px ou mais, hierarquia tipografica dos segundos e lista rolavel.

