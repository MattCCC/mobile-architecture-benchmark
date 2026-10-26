#!/usr/bin/env ruby
# Generates the Xcode project of the iOS acceptance command server (host app + XCUITest bundle) into the directory
# given as the first argument. Run by tools/acceptance/ios.mjs.
require 'fileutils'
require 'xcodeproj'

src = __dir__
out = File.expand_path(ARGV[0] || File.join(src, 'build'))
FileUtils.mkdir_p(out)
project_path = File.join(out, 'MBDriver.xcodeproj')
FileUtils.rm_rf(project_path)
project = Xcodeproj::Project.new(project_path)

host = project.new_target(:application, 'MBDriverHost', :ios, '16.4')
host.source_build_phase.add_file_reference(project.main_group.new_file(File.join(src, 'Host/HostApp.swift')))
tests = project.new_target(:ui_test_bundle, 'MBDriverUITests', :ios, '16.4')
tests.source_build_phase.add_file_reference(project.main_group.new_file(File.join(src, 'UITests/CommandServer.swift')))
tests.add_dependency(host)

common = {
  'SWIFT_VERSION' => '5.0',
  'IPHONEOS_DEPLOYMENT_TARGET' => '16.4',
  'TARGETED_DEVICE_FAMILY' => '1',
  'CODE_SIGN_STYLE' => 'Manual',
  'CODE_SIGN_IDENTITY' => '-',
  'DEVELOPMENT_TEAM' => '',
  'GENERATE_INFOPLIST_FILE' => 'YES',
}
host.build_configurations.each do |c|
  c.build_settings.merge!(common).merge!(
    'PRODUCT_BUNDLE_IDENTIFIER' => 'org.example.mobilebench.acceptance.host',
    'PRODUCT_NAME' => 'MBDriverHost',
    'INFOPLIST_KEY_UILaunchScreen_Generation' => 'YES',
  )
end
tests.build_configurations.each do |c|
  c.build_settings.merge!(common).merge!(
    'PRODUCT_BUNDLE_IDENTIFIER' => 'org.example.mobilebench.acceptance.uitests',
    'PRODUCT_NAME' => 'MBDriverUITests',
    'TEST_TARGET_NAME' => 'MBDriverHost',
  )
end

project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(host)
scheme.add_test_target(tests)
scheme.set_launch_target(host)
scheme.save_as(project_path, 'MBDriver', true)
puts "generated #{project_path}"
