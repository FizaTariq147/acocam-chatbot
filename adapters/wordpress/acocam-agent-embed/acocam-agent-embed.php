<?php
/**
 * Plugin Name: ACOCAM Agent Embed
 * Description: Thin WordPress adapter that loads the AI Agent Platform embed widget (no company logic in WP).
 * Version: 0.1.0
 * Author: ACOCAM / Agent Platform
 */

if (!defined('ABSPATH')) {
    exit;
}

final class Acocam_Agent_Embed {
    public static function init(): void {
        add_action('admin_menu', [self::class, 'admin_menu']);
        add_action('admin_init', [self::class, 'register_settings']);
        add_action('wp_footer', [self::class, 'print_embed'], 99);
    }

    public static function admin_menu(): void {
        add_options_page(
            'Agent Embed',
            'Agent Embed',
            'manage_options',
            'acocam-agent-embed',
            [self::class, 'render_settings']
        );
    }

    public static function register_settings(): void {
        register_setting('acocam_agent_embed', 'acocam_agent_api_base');
        register_setting('acocam_agent_embed', 'acocam_agent_embed_script');
        register_setting('acocam_agent_embed', 'acocam_agent_tenant');
        register_setting('acocam_agent_embed', 'acocam_agent_id');
        register_setting('acocam_agent_embed', 'acocam_agent_publishable_key');
        register_setting('acocam_agent_embed', 'acocam_agent_enabled');
    }

    public static function render_settings(): void {
        if (!current_user_can('manage_options')) {
            return;
        }
        ?>
        <div class="wrap">
            <h1>AI Agent Platform Embed</h1>
            <p>Loads the platform embed script and public config only. Conversation logic stays on the Agent Platform API.</p>
            <form method="post" action="options.php">
                <?php settings_fields('acocam_agent_embed'); ?>
                <table class="form-table">
                    <tr>
                        <th>Enabled</th>
                        <td><label><input type="checkbox" name="acocam_agent_enabled" value="1" <?php checked(get_option('acocam_agent_enabled'), '1'); ?> /> Show widget on public pages</label></td>
                    </tr>
                    <tr>
                        <th>API base</th>
                        <td><input type="url" class="regular-text" name="acocam_agent_api_base" value="<?php echo esc_attr(get_option('acocam_agent_api_base', 'https://api.example.com/v1')); ?>" /></td>
                    </tr>
                    <tr>
                        <th>Embed script URL</th>
                        <td><input type="url" class="regular-text" name="acocam_agent_embed_script" value="<?php echo esc_attr(get_option('acocam_agent_embed_script', 'https://api.example.com/embed/agent-embed.js')); ?>" /></td>
                    </tr>
                    <tr>
                        <th>Tenant</th>
                        <td><input type="text" class="regular-text" name="acocam_agent_tenant" value="<?php echo esc_attr(get_option('acocam_agent_tenant', 'acocam')); ?>" /></td>
                    </tr>
                    <tr>
                        <th>Agent ID</th>
                        <td><input type="text" class="regular-text" name="acocam_agent_id" value="<?php echo esc_attr(get_option('acocam_agent_id', 'customer-support')); ?>" /></td>
                    </tr>
                    <tr>
                        <th>Publishable key</th>
                        <td><input type="text" class="regular-text" name="acocam_agent_publishable_key" value="<?php echo esc_attr(get_option('acocam_agent_publishable_key', '')); ?>" /></td>
                    </tr>
                </table>
                <?php submit_button(); ?>
            </form>
        </div>
        <?php
    }

    public static function print_embed(): void {
        if (is_admin() || get_option('acocam_agent_enabled') !== '1') {
            return;
        }
        $script = get_option('acocam_agent_embed_script');
        $api = get_option('acocam_agent_api_base');
        $tenant = get_option('acocam_agent_tenant', 'acocam');
        $agent = get_option('acocam_agent_id', 'customer-support');
        $key = get_option('acocam_agent_publishable_key', '');
        if (!$script || !$api || !$key) {
            return;
        }
        printf(
            '<script src="%s" data-tenant="%s" data-agent="%s" data-key="%s" data-api="%s"></script>' . "\n",
            esc_url($script),
            esc_attr($tenant),
            esc_attr($agent),
            esc_attr($key),
            esc_url($api)
        );
    }
}

Acocam_Agent_Embed::init();
