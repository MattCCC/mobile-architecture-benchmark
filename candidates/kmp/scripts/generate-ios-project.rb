#!/usr/bin/env ruby
require 'fileutils'
gem 'xcodeproj', '= 1.28.1'
require 'xcodeproj'

candidate = File.expand_path('..', __dir__)
ios = File.join(candidate, 'ios')
project_path = File.join(ios, 'MobileBenchKmp.xcodeproj')
FileUtils.rm_rf(project_path)
project = Xcodeproj::Project.new(project_path)
target = project.new_target(:application, 'MobileBenchKmp', :ios, '16.4')
app = project.main_group.new_group('App', 'App')
Dir.glob(File.join(ios, 'App/**/*.swift')).sort.each do |path|
  target.source_build_phase.add_file_reference(app.new_file(path.delete_prefix(File.join(ios, 'App/'))))
end
fixtures = project.main_group.new_reference('../generated/assets/fixtures')
fixtures.last_known_file_type = 'folder'
target.resources_build_phase.add_file_reference(fixtures)
framework = project.main_group.new_file('../shared/build/bin/$(KMP_FRAMEWORK_TARGET)/releaseFramework/BenchKmp.framework')
target.frameworks_build_phase.add_file_reference(framework)
target.add_system_frameworks(['Metal', 'CoreText', 'CoreGraphics'])
target.build_configurations.each do |config|
  config.build_settings.merge!(
    'PRODUCT_BUNDLE_IDENTIFIER' => 'org.example.mobilebench.kmpapp',
    'PRODUCT_NAME' => 'MobileBenchKmp',
    'INFOPLIST_FILE' => 'App/Info.plist',
    'MARKETING_VERSION' => '0.1.0',
    'CURRENT_PROJECT_VERSION' => '1',
    'SWIFT_VERSION' => '6.0',
    'SWIFT_OPTIMIZATION_LEVEL' => config.name == 'Release' ? '-O' : '-Onone',
    'SWIFT_COMPILATION_MODE' => config.name == 'Release' ? 'wholemodule' : 'singlefile',
    'IPHONEOS_DEPLOYMENT_TARGET' => '16.4',
    'TARGETED_DEVICE_FAMILY' => '1',
    'CODE_SIGN_STYLE' => 'Manual',
    'CODE_SIGN_IDENTITY' => '-',
    'DEVELOPMENT_TEAM' => '',
    'KMP_FRAMEWORK_TARGET' => 'iosSimulatorArm64',
    'FRAMEWORK_SEARCH_PATHS' => '$(inherited) "$(PROJECT_DIR)/../shared/build/bin/$(KMP_FRAMEWORK_TARGET)/releaseFramework"',
    'OTHER_LDFLAGS' => '$(inherited) -lc++',
    'ARCHS' => 'arm64',
    'ONLY_ACTIVE_ARCH' => 'NO',
    'CLANG_ENABLE_MODULES' => 'YES',
    'DEAD_CODE_STRIPPING' => 'YES',
  )
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.set_launch_target(target)
scheme.save_as(project_path, 'MobileBenchKmp', true)
puts "generated #{project_path} (xcodeproj #{Xcodeproj::VERSION})"
