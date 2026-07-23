# Padrão de Documentação da TED (Bookstack)

## Visão Geral

A Wiki TED usa o [Bookstack](https://www.bookstackapp.com/) como plataforma de documentação colaborativa. Este padrão deve ser seguido por **todos os colaboradores** ao criar ou editar conteúdo.

> **Objetivo**: Uniformizar a criação e edição de conteúdo na Wiki TED, garantindo clareza, acessibilidade, consistência e profissionalismo.

---

## 1. Estrutura e Organização

- **Hierarquia Clara:** Use títulos iniciando no **h2** (h2, h3, etc.) — nunca h1 direto, pois o título da página já é h1.
- **Introdução Concisa:** Cada página deve iniciar com um breve resumo do conteúdo.
- **Conteúdo Dividido em Seções:** Use seções com títulos claros e descritivos.
- **Sumário:** Ative o sumário automático do Bookstack (gerado pela estrutura de títulos).
- **Links Internos:** Conecte páginas relacionadas com links internos.
- **Categorização:** Use tags (categorias) do Bookstack de forma consistente.

## 2. Estilo e Formatação

- **Linguagem:** Clara, concisa e objetiva — evitar jargões técnicos complexos.
- **Tom:** Formal e profissional.
- **Frases:** Curtas e simples.
- **Parágrafos:** Curtos, uma ideia principal cada.
- **Ênfase:** Use **negrito** para palavras/chaves importantes e *itálico* para citações ou termos técnicos. Evite excesso.
- **Listas:** Use marcadores ou numeradas para organizar informações.
- **Callouts (destaques):**
  - Sucesso (verde): `class="callout success"` — dicas, objetivos, resultados positivos.
  - Info (azul): `class="callout info"` — informações complementares.
  - Warning (laranja): `class="callout warning"` — atenção, cuidados.
  - Danger (vermelho): `class="callout danger"` — erros, problemas críticos.

## 3. Imagens, Vídeos e Arquivos

- **Imagens:** Relevantes, alta qualidade, bem dimensionadas.
- **Legendas:** Sempre incluir legendas descritivas.
- **Vídeos:** Incorporar na página (não link externo) para otimizar recursos.
- **Formatos de arquivo:** Use padrões acessíveis (PDF, ODT, ODS, DOCX, XLSX).
- **Nomeação:** Nomes claros e descritivos, inclua data quando relevante.
- **Direitos autorais:** Verifique licenças — use materiais com licença adequada ou crie material próprio.

## 4. Fluxo de Criação de Página

1. **Planeje** o conteúdo e a estrutura de títulos.
2. **Crie** a página no Bookstack com um título descritivo (vira h1 automático).
3. **Escreva** a introdução concisa no topo.
4. **Estruture** com h2, h3 conforme a hierarquia.
5. **Adicione** imagens, vídeos e arquivos seguindo as regras acima.
6. **Revise** tom, clareza e formatação.
7. **Categorize** com tags apropriadas.
8. **Publique** e adicione links internos para páginas relacionadas.

## 5. Exemplo de Estrutura de Página

```markdown
### Introdução
Breve resumo do que a página aborda.

### Nome da Seção (h2)
Conteúdo da seção...

#### Subseção (h3)
Detalhes da subseção...

### Tags sugeridas
documentação, tutorial, [categoria], [departamento]
```

## 6. Exemplo de Callout (no HTML do Bookstack)

```html
<p class="callout success">Texto de destaque positivo aqui.</p>
<p class="callout warning">Atenção: algo requer cuidado.</p>
<p class="callout danger">Erro crítico — ação necessária.</p>
```

## 7. Tutoriais para Iniciantes Absolutos

Quando o público-alvo **nunca usou Linux**, o tutorial precisa de camadas extras de explicação.

### Regras de ouro

#### 1. Bloco "O que está acontecendo?" após TODO comando

NUNCA largue um comando sem explicar:

```bash
sudo apt update
```

> **O que está acontecendo?** O `apt update` atualiza a lista de programas disponíveis...

Explique:
- O que o comando **faz** (em português simples, sem jargão)
- **Por que** está sendo executado
- **O que esperar** como saída
- Se o comando é longo, explique cada flag

#### 2. Glossário obrigatório no início

Sempre inclua uma seção "O que é cada coisa":

```markdown
### O que é cada coisa
- **Terminal**: É onde você digita os comandos. Procure no menu por "Terminal"
- **sudo**: Executa como administrador. Vai pedir sua senha
- **apt**: Gerenciador de pacotes — como uma "loja de aplicativos" por comando
- **git**: Ferramenta para baixar código-fonte de repositórios online
```

#### 3. Antecipe o óbvio

- "Quando você digita a senha do sudo, **não aparece nada na tela** — isso é normal"
- "O `~` significa seu diretório home (`/home/seu-usuario`)"
- "A compilação leva de 10 a 30 minutos — é normal ver centenas de linhas de texto"

#### 4. Troubleshooting em toda etapa

Para cada parte, inclua erros **reais** que aconteceram:

```markdown
#### Erro: `Could NOT find Libdrm`

Falta a biblioteca. Instale com:

```bash
sudo apt install -y libdrm-dev
```
```

Sempre inclua:
- A mensagem de erro exata
- A causa (em português simples)
- O comando de correção
- O que fazer depois

#### 5. Referências a IA: regra estrita

- **NUNCA** faça referências no corpo do texto
- **UMA ÚNICA** nota de rodapé no final em callout info
- O guia deve ler como se um humano experiente escreveu do zero

## 8. Lembretes Importantes

- **Nunca use h1** no corpo da página (o título da página já é h1).
- **Sempre** inclua legenda em imagens.
- **Mantenha** parágrafos curtos.
- **Use** listas para informações sequenciais ou agrupadas.
- **Prefira** links internos a repetir conteúdo.
