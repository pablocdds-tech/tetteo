import type { OAuthMetadata } from "@modelcontextprotocol/server";

import type { Config } from "../config.js";
import { ESCOPOS_SUPORTADOS } from "./escopos.js";

/**
 * O CARTÃO DE VISITAS DO SERVIDOR DE AUTORIZAÇÃO (RFC 8414).
 *
 * É a partir daqui que o Claude descobre onde fica o login e como trocar o
 * código por chave. Dois campos decidem se ele consegue conectar:
 *
 *   client_id_metadata_document_supported + "none" em
 *   token_endpoint_auth_methods_supported
 *
 * Com os dois, o Claude se identifica pela URL que a Anthropic publica (CIMD)
 * e dispensa cadastro. Sem `registration_endpoint` de propósito: este servidor
 * não aceita que clientes desconhecidos se registrem sozinhos.
 */

export type MetadadosDoEmissor = OAuthMetadata & {
  client_id_metadata_document_supported: true;
  authorization_response_iss_parameter_supported: true;
};

export function metadadosDoEmissor(
  config: Pick<Config, "emissor">,
): MetadadosDoEmissor {
  const emissor = config.emissor;
  return {
    issuer: emissor,
    authorization_endpoint: `${emissor}/oauth/authorize`,
    token_endpoint: `${emissor}/oauth/token`,
    revocation_endpoint: `${emissor}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [...ESCOPOS_SUPORTADOS],
    client_id_metadata_document_supported: true,
    // RFC 9207: o código volta com `iss`, e o cliente confere de quem veio.
    authorization_response_iss_parameter_supported: true,
  };
}
