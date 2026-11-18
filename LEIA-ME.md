# MeuPlacar

App de placares em preto e azul, instalável no celular, 100% grátis.

## Como funciona

| Peça | Para que serve | Custo |
|---|---|---|
| **GitHub Pages** | Hospeda o app | Grátis |
| **GitHub Actions** (o "robô") | Busca os dados e republica o app a cada ~5 min | Grátis em repositório público |
| **ESPN** (fonte principal) | Futebol, NBA e NFL: jogos, placar, escalação, lances, tabelas, artilharia, elencos e páginas de time | Grátis, sem cadastro |
| **football-data.org** (reserva) | Se a ESPN falhar, entra no lugar dela para jogos, tabela e artilharia do Brasileirão, das 5 grandes ligas, da Liga Portugal e da Champions | Grátis, com cadastro |
| **PandaScore** | CS2 e Valorant: calendário, resultados, elencos e confronto direto | Grátis, com cadastro |
| **VLR.gg** (via vlrggapi, API aberta que o próprio robô liga e desliga) | Valorant: estatísticas de jogadores (rating, ACS, K/D, ADR, HS%) por partida e ranking dos melhores por região | Grátis, sem cadastro |
| **cron-job.org** (opcional) | Dispara o robô no horário certo. O agendamento do próprio GitHub às vezes atrasa 10 a 30 minutos | Grátis, com cadastro |

Se o navegador do celular conseguir acessar a ESPN direto, o placar fica ao vivo de verdade, atualizando a cada 30 s, e aparece "Ao vivo direto da fonte" no topo da lista. Caso contrário, o app usa os dados do robô e mostra "Atualizado há X min".

---

## Passo a passo

### Parte 1: Chaves grátis

**1. PandaScore.** Você já tem: é o "access token" do painel.

**2. football-data.org**
1. Abra https://www.football-data.org/client/register.
2. Preencha nome e e-mail e escolha o plano **Free**.
3. A chave (API token) chega no seu e-mail. Guarde.

### Parte 2: GitHub

**3. Criar o repositório**
1. Abra https://github.com, clique em **New repository** e use o nome `meuplacar`.
2. Marque **Public** (obrigatório para o Pages e o Actions ficarem grátis). As chaves ficam secretas mesmo assim.
3. Clique em **Create repository**.

**4. Subir os arquivos**
1. Descompacte o `meuplacar.zip`.
2. No repositório, clique em **uploading an existing file**.
3. Arraste as pastas **public** e **scripts** e o arquivo **LEIA-ME.md**.
4. Clique em **Commit changes**.

**5. Criar o arquivo do robô**
1. Clique em **Add file → Create new file**.
2. No nome, escreva exatamente: `.github/workflows/atualizar.yml`
3. Abra o arquivo `atualizar.yml` que veio solto no zip, copie todo o conteúdo e cole no GitHub.
4. Clique em **Commit changes**.

**6. Ligar o GitHub Pages**
1. Vá em **Settings → Pages**.
2. Em **Source**, escolha **GitHub Actions**.

**7. Guardar as chaves (Secrets)**
1. Vá em **Settings → Secrets and variables → Actions → New repository secret**.
2. Crie dois segredos, um de cada vez:
   - Name `PANDASCORE_TOKEN`, valor = token da PandaScore
   - Name `FOOTBALL_DATA_TOKEN`, valor = chave do football-data.org

**8. Rodar pela primeira vez**
1. Vá na aba **Actions**. Se aparecer um aviso, clique para habilitar os workflows.
2. Clique em **Atualizar placares → Run workflow → Run workflow**.
3. Espere a bolinha ficar **verde**. A primeira vez leva de 2 a 4 minutos.
4. O endereço do app aparece em **Settings → Pages**. É algo como `https://SEU-USUARIO.github.io/meuplacar/`.

### Parte 3: Deixar o robô no horário certo (opcional, recomendado)

O agendamento do GitHub atrasa em horários de pico. O cron-job.org chama o robô no minuto exato.

**9. Criar uma chave do GitHub só para o robô**
1. No GitHub, clique na sua foto → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Preencha assim:
   - Nome: `meuplacar-robo`
   - Expiração: a maior disponível (anote a data para renovar)
   - **Repository access:** Only select repositories → `meuplacar`
   - **Permissions → Repository permissions → Contents:** Read and write
3. Clique em **Generate token** e copie. Ela começa com `github_pat_`.
4. Essa chave só dá acesso a esse repositório. Mesmo assim, não compartilhe com ninguém.

**10. Configurar o cron-job.org**
1. Crie conta grátis em https://cron-job.org e clique em **Create cronjob**.
2. Preencha:
   - **URL:** `https://api.github.com/repos/SEU-USUARIO/meuplacar/dispatches`, trocando SEU-USUARIO pelo seu usuário do GitHub
   - **Execution schedule:** Every 5 minutes
3. Na aba **Advanced**, preencha:
   - **Request method:** POST
   - **Headers:** adicione três
     - `Accept` = `application/vnd.github+json`
     - `Authorization` = `Bearer ` seguido da chave do passo 9 (com um espaço depois de Bearer)
     - `Content-Type` = `application/json`
   - **Request body:** `{"event_type":"atualizar"}`
4. Salve e clique em **Test run**. Se deu certo, a resposta é **204**, e na aba Actions do GitHub aparece uma execução nova.

### Parte 4: Celular

**11. Instalar o app**
- **Android (Chrome):** abra o endereço → menu ⋮ → **Instalar app**.
- **iPhone (Safari):** abra o endereço → Compartilhar → **Adicionar à Tela de Início**.

---

## O que o app tem

- **Jogos do dia:**
  - Placar ao vivo, data, hora, estádio, cidade e transmissão.
  - Filtros por esporte, por favoritos e "Ao vivo".
- **Ficha do jogo:**
  - Resumo com lances e estatísticas.
  - Escalação.
  - **Confronto:** histórico entre os dois times (últimas 5 temporadas + atual, em todas as competições) e os últimos 5 jogos de cada um.
  - Tabela da competição.
- **Página do time** (toque no escudo ou no nome):
  - Próximos jogos e resultados.
  - Elenco por posição.
  - Estatísticas dos jogadores.
  - **Histórico:** as últimas 5 temporadas, com resumo de cada uma (jogos, vitórias, empates, derrotas e gols), separado por competição.
- **Tabelas:** classificação e artilharia e líderes.
- **E-sports:** mapas, elencos, confronto direto, últimos resultados e transmissões.
- **Valorant (extra):** estatísticas de cada jogador por mapa, rating e ACS no elenco, e ranking dos melhores jogadores por região em Tabelas.
- **Favoritos e agenda**, com exportação para o calendário do celular.

**Quando cada dado é atualizado:**
- Placar e calendário: a cada ~5 minutos.
- Tabelas, artilharia e confrontos de e-sports: de hora em hora.
- Páginas dos times: em rodízio, todos os times a cada ~2 horas.
- Histórico das temporadas anteriores: buscado uma vez para cada time (todos ficam prontos ~6 horas depois da primeira publicação) e revisado 1x por mês.
- Estatísticas do Valorant: ranking de hora em hora; estatísticas das partidas a cada execução, logo depois que terminam.

## Limites que não dá para contornar de graça

- **Estatísticas de jogadores de CS2 e Valorant** (abates, K/D, rating): só no plano pago da PandaScore.
- **Escalação nos e-sports:** mostra o elenco atual do time, não a escalação de cada partida.
- **Valorant:** as estatísticas vêm do VLR.gg por uma API comunitária. Se o VLR.gg mudar o site, essa parte pode parar até a API comunitária ser atualizada. O resto do app continua normal.
- **NFL:** mostra os destaques do jogo (líderes de passe, corrida e recepção), não a escalação completa.
- **Fonte reserva (football-data.org):** tem placar com atraso e não cobre MLS, Série B, Libertadores, Sul-Americana, Copa do Brasil, NBA nem NFL. Nessas, se a ESPN falhar, o app mostra os últimos dados salvos.

## Manutenção

- **Pausa por inatividade:** se o repositório ficar 60 dias sem nenhuma alteração, o GitHub pausa o agendamento interno. O cron-job.org continua chamando normalmente. Se o robô parar, vá em Actions → **Enable workflow**.
- **Chave do cron-job.org:** a chave do GitHub (passo 9) expira. Quando expirar, gere outra e troque no cron-job.org.
- **Robô vermelho:** se a bolinha ficar vermelha na aba Actions, clique na execução e veja a mensagem de erro.
