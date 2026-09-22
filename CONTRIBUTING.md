# Como mexer neste código

Um roteiro curto para a primeira mudança. O **o quê** está no
[README](README.md), o **onde** em [`docs/arquitetura.md`](docs/arquitetura.md);
aqui é o **como**.

## Os três portões

Qualquer mudança passa por estes três, sempre, antes de virar commit:

```bash
npm run typecheck   # tsc --noEmit — tem que sair 0
npm test            # 748 testes — tem que sair 0
npm run lint
```

Nenhum deles precisa de banco, de credencial ou de internet. Se um falha
depois da sua mudança, foi a sua mudança. Rodar os três leva menos de um
minuto e economiza a tarde.

`npm run format` (Prettier) antes de fechar, para o diff não ficar cheio de
ruído de espaço.

## O ciclo

1. **Escreva o teste primeiro quando der.** Bug vira teste que reproduz;
   regra nova vira teste que a descreve. O teste mora num `__tests__` irmão
   do arquivo: mexeu em `src/server/foo.ts`, o teste é
   `src/server/__tests__/foo.test.ts`.
2. **Mude o mínimo.** Toda linha alterada precisa rastrear para o que você se
   propôs a fazer. Não melhore código vizinho, não reformate o que não tocou,
   não refatore o que não está quebrado. Se achou código morto, comente com
   quem te passou o projeto em vez de apagar.
3. **Siga o estilo que já está lá**, mesmo que você faria diferente.
4. **Rode os três portões.**

## Convenções que não são óbvias

**Idioma.** Código, identificadores, comentários e mensagens de commit em
inglês. Tudo que o usuário lê — texto de tela, erro, documentação — em
português, com acentuação preservada. UTF-8 sempre.

**Erro de server action volta como valor**, não como exceção:
`{ ok: false, error: "..." }`, que a camada de UI transforma em toast. Um
`throw` atravessando a fronteira de server action vira uma tela de erro
genérica que não ajuda ninguém.

**Nó de fluxo novo se adiciona em três lugares, nesta ordem:**
`src/lib/flow-schema.ts` (o formato e a validação, em Zod), o `switch` do
`src/server/flow-runner.ts` (o que ele faz), e o editor
(`src/components/nodes.tsx` + `FlowEditor.tsx`). Pular o primeiro faz o fluxo
salvar e não rodar.

**Migração de banco** se cria com `npm run db:migrate` e se aplica em
produção com `npm run db:deploy`. Uma migração já aplicada nunca se edita —
crie outra por cima. E o `schema.prisma` e o código andam juntos: mudar um e
esquecer o outro quebra o build, porque `npm run build` roda
`prisma generate` antes do `next build`.

**Nunca commite o `.env`.** O `.gitignore` já cobre, mas confira o
`git status` antes do push. Se um segredo vazar para o histórico, rotacione
o valor — reescrever a história não basta.

## Quando algo não faz sentido

Pergunte antes de implementar. Uma pergunta antes custa cinco minutos; uma
suposição errada custa o dia inteiro e um diff que precisa ser desfeito.
