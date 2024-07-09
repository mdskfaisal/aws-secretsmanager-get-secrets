import * as core from '@actions/core'
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import {
    buildSecretsList,
    isSecretArn,
    getSecretValue,
    injectSecret,
    extractAliasAndSecretIdFromInput,
    SecretValueResponse, isJSONString,
    parseTransformationFunction
} from "./utils";
import { CLEANUP_NAME } from "./constants";

export async function run(): Promise<void> {
    try {
        core.debug('Starting run function');
        
        core.debug('Creating SecretsManagerClient');
        const client : SecretsManagerClient = new SecretsManagerClient({region: process.env.AWS_DEFAULT_REGION, customUserAgent: "github-action"});
        
        core.debug('Getting secret-ids input');
        const secretConfigInputs: string[] = [...new Set(core.getMultilineInput('secret-ids'))];
        
        core.debug('Getting parse-json-secrets input');
        const parseJsonSecrets = core.getBooleanInput('parse-json-secrets');
        
        core.debug('Getting name-transformation input');
        const nameTransformation = parseTransformationFunction(core.getInput('name-transformation'));

        core.debug('Building secrets list');
        core.info('Building secrets list...');
        const secretIds: string[] = await buildSecretsList(client, secretConfigInputs, nameTransformation);

        core.debug('Initializing secretsToCleanup array');
        let secretsToCleanup = [] as string[];

        core.debug('Logging info about secret name transformation');
        core.info('Your secret names may be transformed in order to be valid environment variables (see README). Enable Debug logging in order to view the new environment names.');

        core.debug('Starting loop to process each secret');
        for (let secretId of secretIds) {
            core.debug(`Processing secret: ${secretId}`);
            
            core.debug('Extracting alias and secretId');
            let secretAlias: string | undefined = undefined;
            [secretAlias, secretId] = extractAliasAndSecretIdFromInput(secretId, nameTransformation);

            core.debug(`Checking if secretId is ARN: ${secretId}`);
            const isArn = isSecretArn(secretId);

            try {
                core.debug(`Getting secret value for: ${secretId}`);
                const secretValueResponse : SecretValueResponse = await getSecretValue(client, secretId);
                const secretValue = secretValueResponse.secretValue;

                core.debug('Checking for blank prefix and JSON parsing');
                if ((secretAlias === '') && !(parseJsonSecrets && isJSONString(secretValue))) {
                    core.debug('Setting secretAlias to undefined due to blank prefix');
                    secretAlias = undefined;
                }

                core.debug('Setting secretAlias if undefined');
                if (secretAlias === undefined) {
                    secretAlias = isArn ? secretValueResponse.name : secretId;
                }

                core.debug(`Injecting secret: ${secretAlias}`);
                const injectedSecrets = injectSecret(secretAlias, secretValue, parseJsonSecrets, nameTransformation);
                core.debug('Updating secretsToCleanup');
                secretsToCleanup = [...secretsToCleanup, ...injectedSecrets];
            } catch (err) {
                core.debug(`Error fetching secret: ${secretId}`);
                core.setFailed(`Failed to fetch secret: '${secretId}'. Error: ${err}.`)
            } 
        }

        core.debug('Exporting cleanup variable');
        core.exportVariable(CLEANUP_NAME, JSON.stringify(secretsToCleanup));

        core.debug('Logging completion message');
        core.info("Completed adding secrets.");
    } catch (error) {
        core.debug('Caught error in run function');
        if (error instanceof Error) core.setFailed(error.message)
    }
}

core.debug('Calling run function');
run();
