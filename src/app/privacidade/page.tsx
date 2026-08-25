export const metadata = {
  title: "Política de Privacidade — ManyChat Clone",
};

/**
 * Public page. The middleware allow-lists /privacidade because Meta fetches
 * this URL unauthenticated when reviewing the app — a login wall here reads
 * as a missing policy and blocks publishing.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Política de Privacidade</h1>
      <p className="mt-2 text-sm text-muted-foreground">Última atualização: 25 de agosto de 2026</p>

      <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-neutral-700">
        <section>
          <h2 className="mb-2 text-lg font-semibold text-neutral-900">O que é esta aplicação</h2>
          <p>
            Esta é uma ferramenta de uso pessoal que automatiza respostas a mensagens diretas e
            comentários da conta profissional do Instagram do seu próprio operador. Não é um produto
            comercial, não é oferecida a terceiros e não possui usuários além do titular da conta.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-neutral-900">Dados que tratamos</h2>
          <p>
            Quando alguém envia uma mensagem ou comenta em uma publicação da conta conectada, a
            aplicação recebe da API do Instagram e armazena:
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5">
            <li>
              O identificador da pessoa no escopo do aplicativo (IGSID), que é específico desta
              aplicação e não revela o perfil fora dela
            </li>
            <li>Nome de usuário, nome de exibição e foto de perfil públicos</li>
            <li>O conteúdo das mensagens trocadas na conversa</li>
            <li>Etiquetas e campos que o próprio operador registra para organizar seus contatos</li>
            <li>
              Anotações que o operador escreve sobre um contato e um histórico de eventos do
              atendimento (etiqueta aplicada, descadastro, entrada em um fluxo)
            </li>
            <li>
              Por até 7 dias, o conteúdo bruto das notificações que a API do Instagram nos envia, e
              por até 30 dias registros técnicos de erro, ambos para diagnóstico. Depois desse prazo
              são apagados automaticamente
            </li>
          </ul>
          <p className="mt-3">
            Não coletamos e não solicitamos senhas, dados de pagamento, documentos, localização ou
            qualquer categoria sensível.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-neutral-900">Para que usamos</h2>
          <p>
            Exclusivamente para responder às conversas iniciadas pela própria pessoa e para que o
            operador acompanhe seu histórico de atendimento. Não usamos os dados para publicidade,
            não criamos perfis comportamentais e não aplicamos decisões automatizadas que produzam
            efeitos jurídicos sobre ninguém.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-neutral-900">Compartilhamento</h2>
          <p>
            Os dados não são vendidos, alugados nem compartilhados com terceiros. Eles trafegam
            apenas entre a API do Instagram, a infraestrutura de hospedagem e o banco de dados desta
            aplicação, ambos usados como prestadores de serviço técnico.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-neutral-900">Retenção e exclusão</h2>
          <p>
            As conversas ficam armazenadas enquanto forem úteis ao atendimento. Os registros
            técnicos têm prazo fixo: notificações brutas do Instagram são apagadas em 7 dias (30
            dias quando o processamento falhou e o registro é a única evidência do ocorrido) e
            registros de erro em 30 dias, por uma rotina automática. Qualquer pessoa pode solicitar
            a exclusão dos seus dados enviando uma mensagem à conta do Instagram conectada, e a
            remoção é feita no banco de dados da aplicação. A desconexão do aplicativo pelo
            Instagram também interrompe imediatamente qualquer novo tratamento.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-neutral-900">Segurança</h2>
          <p>
            O acesso ao painel é protegido por autenticação. As requisições recebidas do Instagram
            são verificadas por assinatura criptográfica (HMAC-SHA256), de modo que apenas
            notificações legítimas da Meta são processadas. As credenciais de configuração ficam em
            variáveis de ambiente e nunca no código-fonte; o token de acesso ao Instagram é guardado
            no banco de dados da aplicação, porque é renovado automaticamente antes de expirar.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-neutral-900">Contato</h2>
          <p>
            Para dúvidas sobre esta política ou pedidos relativos aos seus dados, escreva para{" "}
            <a
              href="mailto:monteirowill93@gmail.com"
              className="text-primary underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              monteirowill93@gmail.com
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
